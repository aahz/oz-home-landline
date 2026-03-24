import {CallbackQuery, Message} from 'node-telegram-bot-api';
import {IAppContext} from '../lib/context';
import {getChatId} from '../lib/telegram';
import {isAdminUser} from '../lib/security';

export const COMMAND_MODE_REGEXP = (/^\/mode\b/i);
export const CALLBACK_MODE_PREFIX = 'mode|';

function sendAccessError(context: IAppContext, entity: Message | CallbackQuery): void {
	const chatId = getChatId(entity);

	if (!chatId) {
		return;
	}

	context.bot.sendMessage(chatId, 'Error: Not enouth priveleges');
}

function formatMode(state: {fallbackPrimarySince?: Date; fallbackForcedUntil?: Date;}): string {
	return state.fallbackPrimarySince ? 'fallback' : 'serial';
}

function formatStateDescription(state: {fallbackPrimarySince?: Date; fallbackForcedUntil?: Date;}): string {
	const currentMode = formatMode(state);
	const fallbackSince = state.fallbackPrimarySince ? state.fallbackPrimarySince.toISOString() : 'n/a';
	const forcedUntil = state.fallbackForcedUntil ? state.fallbackForcedUntil.toISOString() : 'n/a';

	return [
		`Current mode: ${currentMode}`,
		`Fallback since: ${fallbackSince}`,
		`Forced until: ${forcedUntil}`,
	].join('\n');
}

export function sendMode(context: IAppContext, entity: Message | CallbackQuery): void {
	const chatId = getChatId(entity);

	if (!chatId) {
		return;
	}

	const state = context.database.getModemSerialTransportState();

	context.bot.sendMessage(
		chatId,
		formatStateDescription(state),
		{
			reply_markup: {
				inline_keyboard: [[
					{text: 'serial', callback_data: `${CALLBACK_MODE_PREFIX}set|serial`},
					{text: 'fallback', callback_data: `${CALLBACK_MODE_PREFIX}set|fallback`},
				]],
			},
		}
	);
}

export function handleModeCommandMessage(context: IAppContext, message: Message): boolean {
	if (!COMMAND_MODE_REGEXP.test(String(message.text || '').trim())) {
		return false;
	}

	if (!isAdminUser(context, message.from?.id)) {
		sendAccessError(context, message);

		return true;
	}

	sendMode(context, message);

	return true;
}

export function processModeCallback(context: IAppContext, query: CallbackQuery): boolean {
	const callbackData = String(query.data || '');

	if (!callbackData.startsWith(CALLBACK_MODE_PREFIX)) {
		return false;
	}

	if (!isAdminUser(context, query.from?.id)) {
		context.bot.answerCallbackQuery(query.id, {text: 'Error: Not enouth priveleges'});
		sendAccessError(context, query);

		return true;
	}

	const action = callbackData.substring(CALLBACK_MODE_PREFIX.length);

	if (action === 'set|serial') {
		context.database.resetModemSerialFailures();
		context.bot.answerCallbackQuery(query.id, {text: 'Mode switched to serial'});
		sendMode(context, query);

		return true;
	}

	if (action === 'set|fallback') {
		context.database.forceModemFallbackPrimary(30);
		context.bot.answerCallbackQuery(query.id, {text: 'Mode switched to fallback'});
		sendMode(context, query);

		return true;
	}

	context.bot.answerCallbackQuery(query.id, {text: 'Unsupported mode action'});

	return true;
}
