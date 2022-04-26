/**
 * WIP: monitoring for ladder tournaments.
 * Largely borrowed from POSHO-9000. Credits to pre.
 */
import * as PS from 'psim.us';
import {Subfunction, Commands} from '../subfunction';
import * as fs from 'fs';

const MINUTE = 60000;
const INTERVAL = 1000;
const FACTOR = 1.5;

interface TrackerConfig {
    format?: string;
    prefix?: string;
    rating?: number;
    deadline?: string;
    cutoff?: number;
}

interface Battle {
    p1: string;
    p2: string;
    minElo: number;
}
  
interface Leaderboard {
    current?: LeaderboardEntry[];
    last?: LeaderboardEntry[];
    lookup: Map<string, LeaderboardEntry>;
}
  
interface LeaderboardEntry {
    name: string;
    rank?: number;
    elo: number;
    gxe: number;
    glicko: number;
    glickodev: number;
}

type ID = string;

class LadderTracker {
    private readonly config: TrackerConfig;

    private format: ID;
    private prefix: ID;
    private deadline?: Date;
    private rating: number;
    private users: Set<ID>;
  
    private lastid?: string;
    private showdiffs?: boolean;
    private started?: NodeJS.Timeout;
    private final?: NodeJS.Timeout;
  
    private leaderboard: Leaderboard;
  
    private cooldown?: Date;
    private changed?: boolean;
    private lines: { them: number; total: number };
  
    constructor(public room: PS.Room, private parent: Nike, config: TrackerConfig) {
        this.config = config;

        this.format = GAIA.toID(config.format);
        this.prefix = GAIA.toID(config.prefix);
        this.rating = config.rating || 0;
        if (config.deadline) this.setDeadline(config.deadline);
    
        this.users = new Set();
        this.leaderboard = {lookup: new Map()};
        this.showdiffs = false;
    
        this.lines = {them: 0, total: 0};
    }
  
    setDeadline(argument: string) {
        const date = new Date(argument);
        if (!+date) return;
    
        this.deadline = date;
        if (this.final) clearTimeout(this.final);
        // We set the timer to fire slightly before the deadline and then
        // repeatedly do process.nextTick checks for accuracy
        this.final = setTimeout(() => {
            this.stop();
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this.captureFinalLeaderboard();
        }, +this.deadline - Date.now() - 500);
    }
  
    async captureFinalLeaderboard() {
        const now = new Date();
        if (now < this.deadline!) {
            process.nextTick(this.captureFinalLeaderboard.bind(this));
            return;
        }
        const leaderboard = await this.getLeaderboard();
        this.report(`/addhtmlbox ${this.styleLeaderboard(leaderboard, +now)}`);
        this.deadline = undefined;
    }
  
    onQueryresponse(rooms: Record<string, Battle>) {
        const skipid = this.lastid;
        if (!rooms) return;
        for (const [roomid, battle] of Object.entries(rooms)) {
            const [rating, rmsg] = this.getRating(battle);
            if (!this.tracking(battle, rating) || (skipid && skipid >= roomid)) continue;
    
            const style = (p: string) => this.stylePlayer(p);
            const msg = `Battle started between ${style(battle.p1)} and ${style(battle.p2)}`;
            this.report(`/addhtmlbox <a href="/${roomid}" class="ilink">${msg}. ${rmsg}</a>`);
            if (!this.lastid || this.lastid < roomid) this.lastid = roomid;
        }
    }
    formatTimeRemaining(ms: number, round?: boolean): string {
        let s = ms / 1000;
        let h = Math.floor(s / 3600);
        let m = Math.floor((s - h * 3600) / 60);
        s = s - h * 3600 - m * 60;
    
        if (round) {
        s = Math.round(s);
        if (s === 60) {
            s = 0;
            m++;
        }
        if (m === 60) {
            m = 0;
            h++;
        }
        }
    
        const time = [];
        if (h > 0) time.push(`${h} hour${h === 1 ? '' : 's'}`);
        if (m > 0) time.push(`${m} minute${m === 1 ? '' : 's'}`);
        if (s > 0) time.push(`${s} second${s === 1 ? '' : 's'}`);
        return time.join(' ');
    }

    getRating(battle: Battle): [number, string] {
        const p1 = this.leaderboard.lookup.get(GAIA.toID(battle.p1));
        const p2 = this.leaderboard.lookup.get(GAIA.toID(battle.p2));
        if (p1 && p2) return this.averageRating(p1.elo, p2.elo);
        if (p1 && p1.elo > battle.minElo) return this.averageRating(p1.elo, battle.minElo);
        if (p2 && p2.elo > battle.minElo) return this.averageRating(p2.elo, battle.minElo);
        return [battle.minElo, `(min rating: ${battle.minElo})`];
    }
  
    averageRating(a: number, b: number): [number, string] {
        const rating = Math.round((a + b) / 2);
        return [rating, `(avg rating: ${rating})`];
    }
  
    stylePlayer(player: string) {
        return `<username>${player}</strong>`;
    }
  
    tracking(battle: Battle, rating: number) {
        const p1 = GAIA.toID(battle.p1);
        const p2 = GAIA.toID(battle.p2);
    
        // If we are tracking users and a player in the game is one of them, report the battle
        if (this.users.size && (this.users.has(p1) || this.users.has(p2))) {
            return true;
        }
    
        // If a player has an our prefix, report if the battle is above the required rating
        if (p1.startsWith(this.prefix) || p2.startsWith(this.prefix)) {
            return rating >= this.rating;
        }
    
        // Report if a cutoff has been set and both prefixed players are within a factor of the cutoff
        if (this.config.cutoff && p1.startsWith(this.prefix) && p2.startsWith(this.prefix)) {
            const a = this.leaderboard.lookup.get(p1);
            const b = this.leaderboard.lookup.get(p2);
            const rank = this.config.cutoff * FACTOR;
            return a?.rank && a.rank <= rank && b?.rank && b.rank <= rank;
        }
    
        return false;
    }
  
    leaderboardCooldown(now: Date) {
        if (!this.cooldown) return true;
        const wait = Math.floor((+now - +this.cooldown) / MINUTE);
        const lines = this.changed ? this.lines.them : this.lines.total;
        if (lines < 5 && wait < 3) return false;
        const factor = this.changed ? 6 : 1;
        return factor * (wait + lines) >= 60;
    }
  
    getDeadline(now: Date) {
        if (!this.deadline) {
            this.report('No deadline has been set.');
        } else {
            this.report(`**Time Remaining:** ${this.formatTimeRemaining(+this.deadline - +now, true)}`);
        }
    }
  
    tracked() {
        if (!this.users.size) {
            this.report('Not currently tracking any users.');
        } else {
            const users = Array.from(this.users.values()).join(', ');
            const plural = this.users.size === 1 ? 'user' : 'users';
            this.report(`Currently tracking **${this.users.size}** ${plural}: ${users}`);
        }
    }
  
    async getLeaderboard(display?: boolean) {
        const url = `https://pokemonshowdown.com/ladder/${this.format}.json`;
        const leaderboard: LeaderboardEntry[] = [];
        try {
            // @ts-ignore
            const response = await fetch(url).then(res => res.json());
            this.leaderboard.lookup = new Map();
            for (const data of response.toplist) {
                // TODO: move the rounding until later
                const entry: LeaderboardEntry = {
                    name: data.username,
                    elo: Math.round(data.elo),
                    gxe: data.gxe,
                    glicko: Math.round(data.rpr),
                    glickodev: Math.round(data.rprd),
                };
                this.leaderboard.lookup.set(data.userid, entry);
                if (!data.userid.startsWith(this.prefix)) continue;
                entry.rank = leaderboard.length + 1;
                leaderboard.push(entry);
            }
            if (display) {
            this.report(`/addhtmlbox ${this.styleLeaderboard(leaderboard)}`);
            this.leaderboard.last = leaderboard;
            this.changed = false;
            this.lines = {them: 0, total: 0};
            }
        } catch (err: any) {
            this.log(err.message);
            if (display) this.report(`Unable to fetch the leaderboard for ${this.prefix}.`);
        }
    
        return leaderboard;
    }
    log(...args: any[]) {
        this.parent.log(...args);
    }
  
    styleLeaderboard(leaderboard: LeaderboardEntry[], final?: number) {
        const diffs =
            this.leaderboard.last && !final
            ? this.getDiffs(this.leaderboard.last, leaderboard)
            : new Map();
        let buf = '<center>';
        if (final) {
            buf +=
            `<h1 style="margin-bottom: 0.2em">Final Leaderboard - ${this.prefix}</h1>` +
            `<div style="margin-bottom: 1em"><small><em>${final}</em></small></div>`;
        }
        buf +=
            '<div class="ladder" style="max-height: 250px; overflow-y: auto"><table>' +
            '<tr><th></th><th>Name</th><th><abbr title="Elo rating">Elo</abbr></th>' +
            '<th><abbr title="user\'s percentage chance of winning a random battle (aka GLIXARE)">GXE</abbr></th>' +
            '<th><abbr title="Glicko-1 rating system: rating±deviation (provisional if deviation>100)">Glicko-1</abbr></th></tr>';
        for (const [i, p] of leaderboard.entries()) {
            const id = GAIA.toID(p.name);
            const link = `https://www.smogon.com/forums/search/1/?q="${encodeURIComponent(p.name)}"`;
            const diff = diffs.get(id);
            let rank = `${i + 1}`;
            if (diff) {
            const symbol = diff[2] < diff[3]
                ? '<span style="color: #F00">▼</span>'
                : '<span style="color: #008000">▲</span>';
            rank = `${symbol}${rank}`;
            }
            buf +=
                `<tr><td style="text-align: right"><a href='${link}' class="subtle">${rank}</a></td>` +
                `<td><username class="username">${p.name}</strong></td>` +
                `<td><strong>${p.elo}</strong></td><td>${p.gxe.toFixed(1)}%</td>` +
                `<td>${p.glicko} ± ${p.glickodev}</td></tr>`;
        }
        buf += '</table></div></center>';
        return buf;
    }
  
    getDiffs(last: LeaderboardEntry[], current: LeaderboardEntry[], num?: number) {
        const diffs: Map<string, [string, number, number, number]> = new Map();
    
        const lastN = num ? last.slice(0, num) : last;
        for (const [i, player] of lastN.entries()) {
            const id = GAIA.toID(player.name);
            const oldrank = i + 1;
            let newrank = current.findIndex(e => GAIA.toID(e.name) === id) + 1;
            let elo: number;
            if (!newrank) {
            newrank = Infinity;
            elo = 0;
            } else {
            elo = current[newrank - 1].elo;
            }
            if (oldrank !== newrank) diffs.set(id, [player.name, elo, oldrank, newrank]);
        }
    
        const currentN = num ? current.slice(0, num) : current;
        for (const [i, player] of currentN.entries()) {
            const id = GAIA.toID(player.name);
            const newrank = i + 1;
            let oldrank = last.findIndex(e => GAIA.toID(e.name) === id) + 1;
            if (!oldrank) oldrank = Infinity;
            if (oldrank !== newrank) diffs.set(id, [player.name, player.elo, oldrank, newrank]);
        }
    
        return diffs;
    }
  
    trackChanges(leaderboard: LeaderboardEntry[], display?: boolean) {
        if (!this.leaderboard.current || !this.config.cutoff) return;
        const n = this.config.cutoff;
        const diffs = this.getDiffs(this.leaderboard.current, leaderboard, n * FACTOR);
        if (!diffs.size) return;
    
        const sorted = Array.from(diffs.values()).sort((a, b) => a[3] - b[3]);
        const messages = [];
        for (const [name, elo, oldrank, newrank] of sorted) {
            if (!((oldrank > n && newrank <= n) || (oldrank <= n && newrank > n))) {
            this.changed = true;
            }
    
            if (display) {
            const symbol = oldrank < newrank ? '▼' : '▲';
            const rank = newrank === Infinity ? '?' : newrank;
            const rating = elo || '?';
            const message = newrank > n ? `__${name} (${rating})__` : `${name} (${rating})`;
            messages.push(`${symbol}**${rank}.** ${message}`);
            }
        }
    
        if (display) this.report(messages.join(' '));
    }
  
    start() {
        if (this.started) return;
    
        this.report(`/status ${this.rating}`);
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        this.started = setInterval(async () => {
            // Battles
            this.report(`/cmd roomlist ${this.format}`);
    
            // Leaderboard
            const leaderboard = await this.getLeaderboard();
            if (!leaderboard.length) return;
            if (this.leaderboard) this.trackChanges(leaderboard, this.showdiffs);
            this.leaderboard.current = leaderboard;
        }, INTERVAL);
    }
  
    stop() {
        if (this.started) {
            clearInterval(this.started);
            this.started = undefined;
            this.report(`/status (STOPPED) ${this.rating}`);
            this.leaderboard.current = undefined;
            this.leaderboard.last = undefined;
        }
    }
  
    global(command: string) {
        GAIA.send(`|${command}`);
    }
  
    report(message: string) {
        GAIA.send(`${this.room}|${message}`.replace(/\n/g, ''));
    }
}

export class Nike extends Subfunction {
    config: Record<string, any> = (() => {
        try {
            return require('../../data/nike.json');
        } catch {
            return {};
        }
    })();
    private trackers = new Map<string, LadderTracker>();
    async register(client: PS.Client) {
        client.on('queryresponse', (args, line) => {
            if (args[0] !== 'roomlist') return;
            const data = JSON.parse(args.slice(1).join('|'));
            this.handleRoomsData(data);
        });
        if (!this.config.rooms) return;
        for (const roomId in this.config.rooms) {
            const room = await GAIA.client.rooms.get(roomId);
            if (!room) continue;
            const tracker = new LadderTracker(room, this, this.config.rooms[roomId]);
            tracker.start();
            this.trackers.set(room.id, tracker);
        }
    }
    saveData() {
        return fs.writeFileSync(`${__dirname}/../../data/nike.json`, JSON.stringify(this.config));
    }
    handleRoomsData(data: any) {
        for (const tracker of this.trackers.values()) {
            tracker.onQueryresponse(data);
        }
    }
    commands: Commands = {
        'override NIKE tracking for': 'set NIKE to track',
        'set NIKE to track'(target, room, user, sf, cmd) {
            if (!room) {
                return this.respond("This command can only be used in a room.");
            }
            this.room = null;
            if (!this.isRank('%')) {
                return this.respond('Access denied.');
            }
            const nike = GAIA.subfunctions.get('NIKE');
            if (nike.trackers.has(room.id) && !cmd.includes('override')) {
                return this.respond(
                    "NIKE already has a tracker running for that room. " +
                    "To override this, ask GAIA to 'override NIKE tracking for' that room."
                );
            }
            const config: Partial<TrackerConfig> = {};
            /*cutoff?: number;*/
            const rating = Number(/rating ([0-9]+)/.exec(target)?.[1]);
            if (!rating || rating < 1000) {
                return this.respond("Invalid rating. Must be a number above 1000.");
            }
            config.rating = rating;
            const rawCutoff = /cutoff ([0-9]+)/.exec(target)?.[1];
            const cutoff = Number(rawCutoff);
            if (rawCutoff && (!cutoff || cutoff < 1000)) {
                return this.respond("Invalid cutoff. Must be a number above 1000.");
            }
            if (cutoff) {
                config.cutoff = cutoff;
            }
            let deadline = /the deadline ([a-zA-Z0-9-\s:]+)/i.exec(target)?.[1];
            if (deadline && +new Date(deadline)) {
                config.deadline = new Date(deadline).toString();
            }
            const format = GAIA.toID(/format ([a-zA-Z0-9]+)/i.exec(target)?.[1]);
            if (!format) {
                return this.respond("You must specify a format.");
            }
            config.format = format;
            const prefix = GAIA.toID(/prefix ([a-zA-Z0-9]+)/i.exec(target)?.[1]);
            if (!prefix) {
                return this.respond("You must specify a prefix.");
            }
            config.prefix = prefix;

            if (!nike.config.rooms) nike.config.rooms = {};
            nike.config.rooms[room.id] = config;
            nike.saveData();
            const tracker = new LadderTracker(room, nike, config as TrackerConfig);
            tracker.start();
            nike.trackers.set(room.id, tracker);
            this.room = room;
            this.respond("NIKE tracking started.");
        },
        niketrack(target, room, user, sf, cmd) {
            if (!room) {
                return this.respond("This command can only be used in a room.");
            }
            this.room = null;
            if (!this.isRank('%')) {
                return this.respond('Access denied.');
            }
            const nike = GAIA.subfunctions.get('NIKE');
            if (nike.trackers.has(room.id) && !cmd.includes('override')) {
                return this.respond(
                    "NIKE already has a tracker running for that room. " +
                    "To override this, ask GAIA to 'override NIKE tracking for' that room."
                );
            }
            const config: Partial<TrackerConfig> = {};
            /*cutoff?: number;*/
            const rating = Number(/rating=([0-9]+)/.exec(target)?.[1]);
            if (!rating || rating < 1000) {
                return this.respond("Invalid rating. Must be a number above 1000.");
            }
            config.rating = rating;
            const rawCutoff = /cutoff=([0-9]+)/.exec(target)?.[1];
            const cutoff = Number(rawCutoff);
            if (rawCutoff && (!cutoff || cutoff < 1000)) {
                return this.respond("Invalid cutoff. Must be a number above 1000.");
            }
            if (cutoff) {
                config.cutoff = cutoff;
            }
            let deadline = /deadline=([a-zA-Z0-9-\s:]+)/i.exec(target)?.[1];
            if (deadline && +new Date(deadline)) {
                config.deadline = new Date(deadline).toString();
            }
            const format = GAIA.toID(/format=([a-zA-Z0-9]+)/i.exec(target)?.[1]);
            if (!format) {
                return this.respond("You must specify a format.");
            }
            config.format = format;
            const prefix = GAIA.toID(/prefix=([a-zA-Z0-9]+)/i.exec(target)?.[1]);
            if (!prefix) {
                return this.respond("You must specify a prefix.");
            }
            config.prefix = prefix;

            if (!nike.config.rooms) nike.config.rooms = {};
            nike.config.rooms[room.id] = config;
            nike.saveData();
            const tracker = new LadderTracker(room, nike, config as TrackerConfig);
            tracker.start();
            nike.trackers.set(room.id, tracker);
            this.room = room;
            this.respond("NIKE tracking started.");
        },
    }
}

export default Nike;