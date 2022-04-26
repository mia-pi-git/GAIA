/**
 * Handles dispatching commands and info.
 */

import * as PS from 'psim.us';
import {Subfunction, CommandHandler} from '../subfunction';

type KeyedCommand = CommandHandler & {subfunction: Subfunction};
export class Hermes extends Subfunction {
    commandTable: Record<string, KeyedCommand | string> = {};
    register(client: PS.Client) {
        client.on('message', this.handleMessage.bind(this));
        for (const subfunction of GAIA.subfunctions.values()) {
            for (const command of Object.keys(subfunction.commands)) {
                this.commandTable[GAIA.toID(command)] = Object.assign(
                    subfunction.commands[command], {subfunction},
                );
            }
        }
    }
    async handleMessage(message: PS.Message) {
        if (!Array.isArray(this.config.prefix)) {
            this.config.prefix = [this.config.prefix];
            GAIA.saveConfig();
        }
        const prefix = this.config.prefix
            .filter((f: string) => message.text.startsWith(f))[0];
        if (!prefix || !message.from) {
            return;
        }
        let [command, ...args] = message.text.slice(prefix).split(' ');
        command = GAIA.toID(command);
        while (typeof this.commandTable[command] === 'string') {
            command = this.commandTable[command] as string;
        }
        const target = args.join(' ');
        if (!(command in this.commandTable)) {
            if (!message.room) return message.respond("Command not found.");
            return;
        }
        try {
            const handler = this.commandTable[command] as KeyedCommand;
            await handler.call(
                message, target, message.room || null,
                message.from, handler.subfunction
            );
        } catch (e) {
            this.log(e);
            return message.respond("An error occurred. Please stand by.");
        }
    }
    commands: Record<string, CommandHandler> = {
        async join(target, room, user, subfunction) {
            if (room) {
                // need to check gauth
                this.room = null;
            }
            if (!this.isRank("%")) {
                return this.respond("Access denied.");
            }
            if (!target) {
                return this.respond("No room specified.");
            }
            const roomId = GAIA.toID(target);
            const found = await this.client.rooms.get(roomId);
            if (!found) {
                return this.respond(`Room '${roomId}' not found or is inaccessible.`);
            }
            if (subfunction.config.rooms.includes(found.id)) {
                return this.respond("Room already joined.");
            }
            GAIA.config.rooms.push(found.id);
            GAIA.saveConfig();
            this.client.send(`|/join ${roomId}`);
        },
    }
}

export default Hermes;