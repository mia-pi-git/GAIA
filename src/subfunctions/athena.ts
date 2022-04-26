import * as PS from 'psim.us';
import {Subfunction, Commands} from '../subfunction';
import * as pathModule from 'path';

export class Athena extends Subfunction {
    readonly SETTINGS = new class {
        readonly ACTION_THRESHOLD = 3;
        readonly THRESHOLDS = {
            threat: 0.95,
            severe_toxicity: 0.4,
            identity_attack: 0.4,
            insult: 0.9,
            sexual_explicit: 0.5,
        } as Record<string, number>;
        readonly SCORES = {
            default: 1,
        } as Record<string, number>;
        score(results: Record<string, number>) {
            let score = 0;
            for (const [key, value] of Object.entries(results)) {
                if (this.THRESHOLDS[key] >= value) {
                    score += this.SCORES[key] || this.SCORES.default;
                }
            }
            return score;
        }
    };
    private handler!: import('./eleuthia').SpawnProcessManager;
    async register(client: PS.Client) {
        this.handler = GAIA.subfunctions.get("ELEUTHIA").spawn(
            "Spawn", ['python3', '-u', pathModule.resolve(__dirname, '..', '..', 'src/lib/model.py')]
        );
        client.on('message', this.handleMessage.bind(this));
    }
    async predict(message: string) {
        return await this.handler.query(message);
    }
    private async handleMessage(message: PS.Message) {
        const room = message.room;
        if (!room) return;
        if (!this.config.athenaRooms?.includes(room.id)) {
            return;
        }
        const results = await this.predict(message.text);
        if (this.SETTINGS.score(results) >= this.SETTINGS.ACTION_THRESHOLD) {
            // action
            const apollo = GAIA.subfunctions.get("APOLLO");
            apollo.write(
                "athena", 
                apollo.strip`${message.from}: ${message.text}: ${JSON.stringify(results)}`
            );
        }
    }
    close() {}
    commands: Commands = {
        'toggle ATHENA': 'togglemod',
        async togglemod(target, room, user, subfunction) {
            target = GAIA.toID(target);
            if (!room) {
                let [roomId, ...rest] = target.split(',').map(f => f.trim());
                roomId = GAIA.toID(roomId);
                room = await this.client.rooms.get(roomId) || null;
                if (!room) {
                    return this.respond(`Room '${roomId}' not found.`);
                }
                this.room = room;
                target = rest.join(',').trim();
            }
            if (!this.isRank("#")) {
                return this.respond("Access denied.");
            }
            const savedIdx = subfunction.config.athenaRooms.indexOf(room.id);
            if (target === 'on') {
                if (savedIdx > -1) {
                    return this.respond("Moderation already enabled.");
                }
                GAIA.config.athenaRooms.push(room.id);
                GAIA.saveConfig();
                return this.respond("Moderation enabled.");
            } else if (target === 'off') {
                if (savedIdx === -1) {
                    return this.respond("Moderation already disabled.");
                }
                GAIA.config.athenaRooms.splice(savedIdx, 1);
                GAIA.saveConfig();
                return this.respond("Moderation disabled.");
            } else {
                return this.respond("Invalid setting - must be 'on' or 'off'.");
            }
        },
        'run ATHENA on': 'atest',
        async atest(target, room, user) {
            if (this.room) {
                this.room = null;
            }
            if (user.id !== 'mia') return;
            const athena = GAIA.subfunctions.get("ATHENA");
            const results = await athena.predict(target);
            const score = athena.SETTINGS.score(results);
            const hit = score >= athena.SETTINGS.ACTION_THRESHOLD;
            let buf = `Results for "${target}": ${hit ? "hit" : "allowed"} (${score})\n`;
            buf += Object.entries(results)
                .map(([key, value]) => `${key}: ${value}`)
                .join('\n');
            this.respond(`!code ${buf}`);
        },
    };
}

process.on('uncaughtException', (err: any) => {
    if (err.message.includes('callstack')) {
        // not sure why this happens when calling predict not in a repl, but it 
        // does... so i'm suppressing it
        return;
    }
    GAIA.log(err);
});

export default Athena;