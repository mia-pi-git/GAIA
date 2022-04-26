/**
 * Main parent class.
 */
import * as PS from 'psim.us';
import * as fs from 'fs';
import {SubfunctionTable, Subfunction} from './subfunction';

export class GAIA {
    subfunctions = new SubfunctionTable();
    constructor(public client: PS.Client, public config: any) {}
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
            this.log(`${name} loaded.`);
        }
        this.log("GAIA intialization complete. All subfunctions registered.");
        this.log("Connecting now.");
        this.client.connect();
    }
    toID(text: any): string {
        return (text && typeof text === "string" ? text : "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    }
    saveConfig() {
        fs.writeFileSync('./config.json', JSON.stringify(this.config, null, 2));
    }
    log(...args: any[]) {
        console.log(`[${new Date().toTimeString().split(' ')[0]}] [GPRIME]`, ...args);
    }
    send(message: string) {
        this.client.send(message);
    }
}