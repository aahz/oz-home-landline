import {getEnv} from "../utility";

export const TOKEN = String(getEnv('BOT_TOKEN', ''));
export const ALLOWED_USER_IDS = (
	String(getEnv('BOT_ALLOWED_USER_IDS', ''))
		.split(',')
		.map((userId) => userId.trim())
		.filter((userId) => /[0-9]+/.test(userId))
		.map(userId => Number(userId))
);

export const PROXY_HOST = String(getEnv('BOT_PROXY_HOST', '0.0.0.0'));
export const PROXY_PORT = String(getEnv('BOT_PROXY_PORT', '1080'));
export const PROXY_USER = String(getEnv('BOT_PROXY_USER', ''));
export const PROXY_PSWD = String(getEnv('BOT_PROXY_PSWD', ''));
