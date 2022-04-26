/**
 * Subfunction structure.
 */
import * as PS from 'psim.us';
import * as fs from 'fs';
import {GAIA} from './main';
// subfunctions!

export type CommandHandler = (
    this: PS.Message, target: string, room: PS.Room | null, 
    user: PS.User, subfunction: Subfunction, cmd: string,
) => void | Promise<void>;
export type Commands = Record<string, CommandHandler | string>;

export class SubfunctionTable extends Map<string, Subfunction> {
    // todo figure out how to make this not hardcoded
    get(key: `ELEUTHIA`): import('./subfunctions/eleuthia').default;
    get(key: `APOLLO`): import('./subfunctions/apollo').default;
    get(key: `HERMES`): import('./subfunctions/hermes').default;
    get(key: `ATHENA`): import('./subfunctions/athena').default;
    get(key: `NIKE`): import('./subfunctions/nike').default;
    get(key: string): Subfunction | undefined;
    get(key: string) {
        return super.get(key);
    }
}

export abstract class Subfunction {
    static functions = new SubfunctionTable();
    commands: Commands = {};
    subfunctions = Subfunction.functions;
    config: any;
    constructor(public parent: GAIA) {
        parent.subfunctions.set(this.constructor.name.toUpperCase(), this);
        this.config = parent.config;
    }
    abstract register(client: PS.Client): void | Promise<void>;
    log(...args: any[]) {
        console.log(
            `[${new Date().toTimeString().split(' ')[0]}] ` +
            `[${this.constructor.name.toUpperCase()}]`, ...args
        );
    }
    close() {}
}