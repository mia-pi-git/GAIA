/**
 * Handles dispatching commands and info.
 */

import * as PS from 'psim.us';
import {Subfunction, CommandHandler, Commands} from '../subfunction';

type KeyedCommand = CommandHandler<any> & {subfunction: Subfunction};
export class Hermes extends Subfunction {
    color = `\x1b[33m`;
    commandTable: Record<string, KeyedCommand | string> = {};
    register(client: PS.Client) {
        client.on('message', this.handleMessage.bind(this));
        for (const subfunction of GAIA.subfunctions.values()) {
            for (const command of Object.keys(subfunction.commands)) {
                const cmd = subfunction.commands[command];
                this.commandTable[command] = typeof cmd === 'string' ? 
                    cmd : Object.assign(cmd, {subfunction})
            }
        }
    }
    async handleMessage(message: PS.Message) {
        if (!Array.isArray(this.config.prefix)) {
            this.config.prefix = [this.config.prefix];
            GAIA.saveConfig();
        }
        if (message.text.startsWith('/invite ')) {
            if (message.isRank('%')) {
                const room = message.text.slice('/invite '.length);
                if (!GAIA.config.rooms.includes(room)) {
                    GAIA.log(`Invited to ${room} by ${message.from}`);
                    GAIA.config.rooms.push(room);
                    GAIA.saveConfig();
                    GAIA.client.send(`|/join ${room}`);
                }
            }
        }
        const prefix = this.config.prefix
            .filter((f: string) => message.text.startsWith(f))[0];
        if (!prefix || !message.from) {
            return;
        }
        const parts = message.text.slice(prefix.length).split(' ');
        let command = '', args: string[] = [];
        while (parts.length) {
            const part = parts.shift();
            if (!part) break;
            command += ` ${part}`;
            command = command.trim();
            if (this.commandTable[command]) {
                args = parts;
                break;
            }
            const id = GAIA.toID(command);
            const keys = Object.keys(this.commandTable);
            const idx = keys.map(GAIA.toID).indexOf(id);
            if (idx > -1) {
                command = keys[idx];
                args = parts;
                break;
            }
        }
        // command = GAIA.toID(command);
        const cmd = command;
        while (typeof this.commandTable[command] === 'string') {
            command = this.commandTable[command] as string;
        }
        if (!(command in this.commandTable)) {
            if (!message.room) return message.respond("Command not found.");
            return;
        }
        const target = args.join(' ');
        try {
            const handler = this.commandTable[command] as KeyedCommand;
            await handler.call(
                message, target, message.room || null,
                message.from, handler.subfunction, cmd
            );
        } catch (e) {
            this.log(e);
            return message.respond("An error occurred. Please stand by.");
        }
    }
    commands: Commands<Hermes> = {
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
            const roomId = GAIA.toRoomID(target);
            const found = await this.client.rooms.get(roomId);
            if (!found) {
                return this.respond(`Room '${roomId}' not found or is inaccessible.`);
            }
            const data = await this.client.query('userdetails', [GAIA.config.name]) || {};
            if (Object.keys(data.rooms).filter(f => GAIA.toRoomID(f) === roomId)) {
                return this.respond("Room already joined.");
            }
            GAIA.config.rooms.push(found.id);
            GAIA.saveConfig();
            this.client.send(`|/join ${roomId}`);
        },
        async leave(target, room, user, sf) {
            if (room && !target) {
                target = room.id;
            }
            this.room = null;
            if (!this.isRank('@')) {
                if (!room) return this.respond("Access denied.");
                return;
            }
            if (!target) {
                return this.respond("No room specified.");
            }
            const roomId = GAIA.toRoomID(target);
            const data = await this.client.query('userdetails', [GAIA.config.name]) || {};
            if (!Object.keys(data.rooms).filter(f => GAIA.toRoomID(f) === roomId)) {
                return this.respond("Room not joined.");
            }
            GAIA.config.rooms.splice(GAIA.config.rooms.indexOf(roomId), 1);
            GAIA.saveConfig();
            GAIA.client.send(`${roomId}|/leave`);
        },
    };
}

export default Hermes;