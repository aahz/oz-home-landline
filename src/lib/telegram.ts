import {CallbackQuery, Message} from 'node-telegram-bot-api';

export function getChatId(entity: Message | CallbackQuery): number | undefined {
	return (entity as CallbackQuery)?.message?.chat?.id || (entity as Message)?.chat?.id;
}

export function getFromId(entity: Message | CallbackQuery): number | undefined {
	return entity?.from?.id;
}

export function toRows(items: {text: string; callback_data: string}[], size: number = 1): {text: string; callback_data: string}[][] {
	return items.reduce((result, item, index) => {
		const rowIndex = Math.floor(index / size);

		if (!result[rowIndex]) {
			result[rowIndex] = [];
		}

		result[rowIndex].push(item);

		return result;
	}, [] as {text: string; callback_data: string}[][]);
}
