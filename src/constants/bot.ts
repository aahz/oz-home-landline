import {getEnv} from "../utility";

export const TOKEN = String(getEnv('BOT_TOKEN', ''));

const ADMIN_USER_ID_RAW = String(getEnv('BOT_ADMIN_USER_ID', '')).trim();
export const ADMIN_USER_ID = (
	(/[0-9]+/).test(ADMIN_USER_ID_RAW)
		? Number(ADMIN_USER_ID_RAW)
		: undefined
);

export const PROXY_HOST = String(getEnv('BOT_PROXY_HOST', '0.0.0.0'));
export const PROXY_PORT = String(getEnv('BOT_PROXY_PORT', '1080'));
export const PROXY_USER = String(getEnv('BOT_PROXY_USER', ''));
export const PROXY_PSWD = String(getEnv('BOT_PROXY_PSWD', ''));
