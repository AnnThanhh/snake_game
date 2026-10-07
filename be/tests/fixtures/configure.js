import {readFile} from 'node:fs/promises';
import {configureContent} from '../../game/content.js';
import {configureBuilds} from '../../game/builds.js';
const fixture=JSON.parse(await readFile(new URL('./legacy-content.json',import.meta.url),'utf8'));configureContent(fixture);configureBuilds(fixture);
