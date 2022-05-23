/**
 * Handles dev tooling and other creation features.
 * REPL code borrowed from play.pokemonshowdown.com
 */

import {Subfunction, Commands} from '../subfunction';
import * as net from 'net'; 
import * as repl from 'repl';
import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';
import * as child_process from 'child_process';

export class Hephaestus extends Subfunction {
	color = '\x1b[35m';
    pathnames = new Set<string>();
    async register() {
        // attached to GAIA so evals can be done in that context
        this.start('app', cmd => eval(cmd));
    }
    start(filename: string, evalFn: (input: string) => any) {
		this.setupListeners();

		if (filename === 'app') {
			const directory = path.dirname(path.resolve(__dirname, '..', 'repl', 'app'));
			try {
				const files = fs.readdirSync(directory);
                for (const file of files) {
					const pathname = path.resolve(directory, file);
					const stat = fs.statSync(pathname);
					if (!stat.isSocket()) continue;

					const socket = net.connect(pathname, () => {
						socket.end();
						socket.destroy();
					}).on('error', () => {
						fs.unlink(pathname, () => {});
					});
				}
			} catch {}
		}

        // const apollo = GAIA.subfunctions.get('APOLLO');
		const server = net.createServer(socket => {
            const history: string[] = [];
			repl.start({
				input: socket,
				output: socket,
				eval(cmd, context, unusedFilename, callback) {
                    // apollo.write('repl', apollo.strip`${filename}: ${cmd}`);
                    let noHistory = false;
                    if (history.length) {
                        switch (cmd) {
                        case '^[[A':
                            noHistory = true;
                            cmd = history.at(-1) || cmd;
                            break;
                        }
                    }
					try {
                        if (!noHistory) history.push(cmd);
						return callback(null, evalFn(cmd));
					} catch (e: any) {
						return callback(e, undefined);
					}
				},
			}).on('exit', () => socket.end());
			socket.on('error', () => socket.destroy());
		});

		const pathname = path.resolve(__dirname, '..', '..', 'repl', filename);
		try {
			server.listen(pathname, () => {
				fs.chmodSync(pathname, 0o600);
				this.pathnames.add(pathname);
			});

			server.once('error', (err: NodeJS.ErrnoException) => {
				server.close();
				if (err.code === "EADDRINUSE") {
					fs.unlink(pathname, _err => {
						if (_err && _err.code !== "ENOENT") {
							this.log(_err, `REPL: ${filename}`);
						}
					});
				} else if (err.code === "EACCES") {
					if (process.platform !== 'win32') {
						this.log(`Could not start REPL server "${filename}": ${err.message}`);
					}
				} else {
					this.log(err, `REPL: ${filename}`);
				}
			});

			server.once('close', () => {
				this.pathnames.delete(pathname);
			});
		} catch (err) {
			console.error(`Could not start REPL server "${filename}": ${err}`);
		}
	}
    listenersSetup = false;

	setupListeners() {
		if (this.listenersSetup) return;
		this.listenersSetup = true;
		process.once('exit', code => {
			for (const s of this.pathnames) {
				try {
					fs.unlinkSync(s);
				} catch {}
			}
			if (code === 129 || code === 130) {
				process.exitCode = 0;
			}
		});
		if (!process.listeners('SIGHUP').length) {
			process.once('SIGHUP', () => process.exit(128 + 1));
		}
		if (!process.listeners('SIGINT').length) {
			process.once('SIGINT', () => process.exit(128 + 2));
		}
	}
    commands: Commands<Hephaestus> = {
        evaluate: 'eval',
        async eval(target, room, user) {
            if (user.id !== 'mia') return;
            let res;
            try {
                res = await Promise.resolve(eval(target));
            } catch (e: any) {
                res = `Error: ${e.stack}`;
            }
			res = util.inspect(res);
			res = res.replace(new RegExp(GAIA.config.pass, "g"), "[redacted]");
            this.respond(`!code ${res}`);
        },
        async reload(target, room, user) {
            if (user.id !== 'mia') return;
            const sub = GAIA.toID(target).toUpperCase();
            const existing = GAIA.subfunctions.get(sub);
            if (!existing) {
                return this.respond(`Invalid subfunction: ${sub}.`);
            }
            this.privateRespond("Reloading...");
            const file = require.resolve(`./${sub.toLowerCase()}`);
            delete require.cache[file];
            const mod = require(file);
            const fn = new mod.default(GAIA);
            await fn.register(GAIA.client);
            existing.close();
            GAIA.subfunctions.set(sub, fn);
            this.privateRespond(`${sub} reloaded.`);
        },
        'execute Order 66': 'kill',
        kill(target, room, user) {
            if (user.id !== 'mia') return;
            process.emit('SIGINT');
            setTimeout(() => process.exit(), 500);
        },
		update(target, room, user) {
			if (user.id !== 'mia') return;
			try {
				child_process.execSync('git stash');
				child_process.execSync("git pull origin main");
				child_process.execSync("git stash pop");
			} catch (e: any) {
				if (!e.message.includes("No stash entries found.")) {
					this.privateRespond("!code Error: " + e.stdout + e.stderr);
					return;
				}
			}
			this.respond("Updated.");
		},
		execute(target, room, user) {
			if (user.id !== 'mia') return;
			child_process.exec(target, (err, stdout, stderr) => {
				if (err || stderr) {
					this.room = null;
					if (err) {
						return this.privateRespond(`!code Error: ${err.message}`);
					}
					if (stderr) {
						return this.privateRespond(`!code stderr: ${stderr}\nstdout: ${stdout}`);
					}
				}
				if (room) this.respond("Done.");
				if (stdout) return this.privateRespond(`!code ${stdout}`);
			});
		},
		say(target, room, user) {
			if (user.id !== 'mia') return;
			this.respond(target);
		},
    }
}

export default Hephaestus;