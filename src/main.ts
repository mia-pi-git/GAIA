/**
 * Main parent class.
 */
import * as PS from 'psim.us';
import * as fs from 'fs';
import {SubfunctionTable, Subfunction} from './subfunction';

export class GAIA {
    subfunctions = new SubfunctionTable();
    user!: PS.User;
    constructor(public client: PS.Client, public config: any) {
        this.user = new PS.User(client);
    }
    async load() {
        this.log("Beginning GAIA intialization.");
        const files = fs.readdirSync(__dirname + "/subfunctions");
        const loaded = new Map<string, Subfunction>();
        this.log('Registering subfunctions...');
        for (const file of files) {
            const subfunction = require(`./subfunctions/${file}`).default;
            if (!subfunction) {
                continue; // wip;
            }
            loaded.set(
                subfunction.name.toUpperCase(), new subfunction(this)
            );
        }

        // this.eval = (cmd: string) => eval(cmd);

        for (const [name, sub] of loaded) {
            await sub.register(this.client);
            this.log(`${sub.color}${name}\x1b[0m loaded.`);
        }
        this.log("GAIA intialization complete. All subfunctions registered.");
        this.log("Connecting now.");
        this.client.connect();
        this.client.on('ready', async () => {
            const user = await this.client.users.get(this.config.name);
            if (user) {
                this.user = user;
            }
        });
    }

    toRoomID(text: any) {
        if (typeof text !== 'string' && typeof text !== 'number') return '';
        return ('' + text)
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, '') as string;
    }
   
    toID(text: any) {
        if (text && text.id) {
            text = text.id;
        } else if (text && text.userid) {
            text = text.userid;
        } else if (text && text.roomid) {
            text = text.roomid;
        }
        if (typeof text !== 'string' && typeof text !== 'number') return '';
        return ('' + text)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '') as string;
    }

    saveConfig() {
        fs.writeFileSync('./config.json', JSON.stringify(this.config, null, 2));
    }
    log(...args: any[]) {
        console.log(
            `[${new Date().toTimeString().split(' ')[0]}] ` +
            `\x1b[32m[GPRIME]\x1b[0m`, ...args);
    }
    send(message: string) {
        this.client.send(message);
    }
}