/**
 * Handles logging and storage.
 */
import {Subfunction} from '../subfunction';
import * as PS from 'psim.us';
import * as fs from 'fs';

export class Apollo extends Subfunction {
    streams = new Map<string, fs.WriteStream>();
    register(client: PS.Client) {
        try {
            fs.mkdirSync('./logs');
        } catch {}
        client.on('message', message => {
            if (!message.room) {
                this.write(
                    'messages', 
                    this.strip`PM: ${message.from}: ${message.text}`
                );
            } else {
                this.write(
                    `rooms-${message.room}`, 
                    this.strip`${message.from}: ${message.text}`
                );
            }
        });
    }
    write(name: string, data: string) {
        let stream = this.streams.get(name);
        if (!stream) {
            stream = fs.createWriteStream(`logs/${name}.log`, {flags: 'a+'});
            this.streams.set(name, stream);
        }
        stream.write(`[${new Date().toString().split(' (')[0]}] ${data}\n`);
    }
    strip(strings: TemplateStringsArray, ...args: any) {
        let buf = strings[0];
        let i = 0;
        while (i < args.length) {
            buf += (args[i] + "").replace(/\n/ig, ' | ');
            buf += strings[++i];
        }
        return buf;
    }
    close() {
        for (const [k, stream] of this.streams) {
            stream.end();
            this.streams.delete(k);
        }
        // TODO: on reload, apollo starts logging twice - do better cleanup
    }
}

export default Apollo;