import * as PS from 'psim.us';
import * as fs from 'fs';
import {GAIA} from './main';

if (!fs.existsSync('config.json')) {
    console.log("Copying config-example to config");
    fs.copyFileSync('config-example.json', 'config.json');
}

const config = require('../config.json');
const ps = new PS.Client(config);
global.GAIA = new GAIA(ps, config);
global.GAIA.load();