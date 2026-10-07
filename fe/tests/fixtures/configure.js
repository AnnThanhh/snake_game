import {readFile} from 'node:fs/promises';
import {configureContent} from '../../public/game/content.js';
import {configureBuilds} from '../../public/game/builds.js';
const fixture=JSON.parse(await readFile(new URL('./legacy-content.json',import.meta.url),'utf8'));configureContent(fixture);configureBuilds(fixture);
