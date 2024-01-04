import {getEnv} from "../utility";

export const MODE = String(getEnv('ENV_MODE', 'development')) as ('development' | 'production');

export const IS_PRODUCTION = MODE === 'production';
