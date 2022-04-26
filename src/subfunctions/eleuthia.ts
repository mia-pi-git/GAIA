/**
 * Handles child processes.
 */
import * as PS from 'psim.us';
import {Subfunction} from '../subfunction';
import {fork, spawn, ChildProcess, ChildProcessWithoutNullStreams} from 'child_process';

interface ResolveEntry {
    resolve: (value?: any) => void;
    reject: (err?: any) => void;
}

export abstract class ProcessManagerBase {
    taskId = 0;
    abstract query(data: any): Promise<any>;
    abstract spawn(num: number): void;
    abstract destroy(): void;
}

export class SpawnProcessManager<I = any, O = any> extends ProcessManagerBase {
    processes: (ChildProcessWithoutNullStreams & {load: number})[] = [];
    tasks = new Map<string, ((data: any) => void)>();
    constructor(private args: string[], private parent: Eleuthia) {
        super();
    }
    spawn(num: number) {
        const args = this.args;
        for (let i = 0; i < num; i++) {
            const proc = Object.assign(spawn(args[0], args.slice(1)), {load: 0})
            this.processes.push(proc);
            proc.stdout.setEncoding('utf8');
            proc.stderr.setEncoding('utf8');
            proc.stdout.on('data', (data) => {
                // so many bugs were created by \nready\n
                data = data.trim();
                const [taskId, dataStr] = data.split("|");
                const resolve = this.tasks.get(taskId);
                if (resolve) {
                    this.tasks.delete(taskId);
                    proc.load--;
                    return resolve(JSON.parse(dataStr));
                }
                if (taskId === 'error') { // there was a major crash and the script is no longer running
                    const info = JSON.parse(dataStr);
                    this.parent.log(`A spawned child process crashed:`, info)
                    try {
                        this.processes.splice(i, 1);
                        proc.disconnect();
                    } catch {}
                }
            });
            proc.stderr.on('data', data => {
                if (/Downloading: ([0-9]+)%/i.test(data)) {
                    // this prints to stderr fsr and it should not be throwing
                    return;
                }
                this.parent.log(`A spawned child process errored:`, data);
            });
            proc.on('error', err => {
                this.parent.log(`A spawned child process crashed:`, err);
            });
            proc.on('close', () => {
                this.processes.splice(i, 1);
            });
        }
    }
    query(data: I): Promise<O> {
        const taskId = this.taskId++;
        return new Promise((resolve, reject) => {
            let proc;
            for (const p of this.processes) {
                if (!proc || p.load < proc.load) {
                    proc = p;
                }
            }
            if (!proc) return reject("No process found.");
            this.tasks.set(taskId.toString(), resolve);
            proc.stdin.write(`${taskId}|${JSON.stringify(data)}\n`);
            proc.load++;
        });
    }
    destroy() {
        for (const [i, p] of this.processes.entries()) {
            p.disconnect();
            this.processes.splice(i, 1);
        }
    }
}

export class QueryProcessManager extends ProcessManagerBase {
    processes: (ChildProcess & {load: number})[] = [];
    private resolvers = new Map<string, ResolveEntry>();
    constructor(private parent: Eleuthia, private callback: (message: any) => any) {
        super();
    }
    destroy() {
        this.processes.map(f => f.disconnect());
        this.processes = [];
    }
    spawn(num: number) {
        for (let i = 0; i < num; i++) {
            const proc = fork(__filename);
            this.processes.push(Object.assign(proc, {load: 0}));
            proc.on('error', err => {
                this.processes.splice(i, 1);
                this.parent.log("Child process crashed", err);
            });
            proc.on('message', message => {
                const [id, ...rest] = (message + "").split('\n');
                const {resolve, reject} = this.resolvers.get(id) || {};
                this.resolvers.delete(id);
                if (rest[0] === 'ERR') {
                    return reject?.(rest.slice(1).join('\n'));
                }
                if (resolve) {
                    return resolve(JSON.parse(rest.join('\n')));
                }
            });
            proc.send('CALLBACK\n' + this.callback.toString());
        }
    }
    query(data: any) {
        const id = Math.random().toString();
        return new Promise((resolve, reject) => {
            this.resolvers.set(id, {resolve, reject});
            let proc;
            for (const p of this.processes) {
                if (!proc || p.load < proc.load) {
                    proc = p;
                }
            }
            if (!proc) return reject(new Error("No processes available"));
            proc.send(id + '\n' + JSON.stringify(data));
        });
    }
}

export class Eleuthia extends Subfunction {
    processes: ProcessManagerBase[] = [];
    readonly TYPES = {
        'Spawn': SpawnProcessManager,
        'Query': QueryProcessManager,
    }
    register(client: PS.Client) {}

    spawn<I = any, O = any>(
        type: 'Spawn', queryArgs: string[], num?: number
    ): SpawnProcessManager<I, O>;
    spawn<I, O>(type: 'Query', cb: QueryProcessManager['callback'], num?: number): QueryProcessManager;
    spawn(type: string, ...args: any[]): ProcessManagerBase;
    spawn(type: string, ...args: any[]): ProcessManagerBase {
        let proc;
        if (type === 'Spawn') {
            proc = new SpawnProcessManager(args[0], this);
        } else if (type === 'Query') {
            proc = new QueryProcessManager(this, args[0]);
        } else {
            throw new Error("Invalid type: " + type);
        }
        proc.spawn(args[1] || 1);
        this.processes.push(proc);
        return proc;
    }
    close() {
        this.processes.map(f => f.destroy());
    }
}

if (require.main === module) {
    let callback: any;
    process.on('message', (message: any) => {
        message = message.toString();
        const [id, ...rest] = message.split('\n');
        if (id === 'CALLBACK') {
            callback = eval(rest.join('\n'));
        } else {
            if (!callback) return;
            Promise.resolve(callback(JSON.parse(rest.join('\n'))))
                .then(res => process.send!(id + '\n' + JSON.stringify(res || null)))
                .catch(err => process.send!(id + '\nERR\n' + err.stack));
        }
    });
}

export default Eleuthia;