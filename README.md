# GAIA 
To start, move `config-example.json` to `config.json`, edit it to your needs, then run `npm run start`.

Settings config: 
```ts
export interface Settings {
    name: string;
    pass: string;
    rooms?: string[];
    prefix?: string;
    status?: string;
    avatar?: string;
    reconnectMs?: number;
}
```