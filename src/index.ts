import {Message as ITBotMessage} from "node-telegram-bot-api";

import {Bot} from "./bot";
import {Modem} from "./modem";

import * as C from './constants';

const bot = new Bot({
	token: C.BOT.TOKEN,
});

const modem = new Modem({
	path: C.MODEM.PATH,
	baudRate: C.MODEM.BAUD_RATE,
	timeout: 1000,
});

function sendList(api: Bot['api'], chatId: number): void {
	api
		.sendMessage(chatId, 'List of available gates:', {
			reply_markup: {
				inline_keyboard: C.GATES.LIST.reduce((result, gate) => ([
					...result,
					gate.phoneNumbers.map((phoneNumber, index) => ({
						text: `${gate.title} (${index} / ${phoneNumber.slice(4)})`,
						callback_data: `/gate_open ${gate.id} ${index}`,
					})),
				]), [] as {text: string; callback_data: string}[][]),
				is_persistent: true,
			}
		})
		.then((message) => {
			console.log(`List sent to ${message.chat.id}.`);
		})
		.catch((error) => {
			console.error(error);
		});
}

function openGate(api: Bot['api'], chatId: number, command: string): void {
	const regexp = /\/gate_open\s+(?<id>[-_a-z0-9]+)\s?(?<phoneNumberIndex>[0-9]+)?/gi;
	const data = regexp.exec(command)

	if (!data) {
		return sendList(api, chatId);
	}

	const gate = C.GATES.LIST.find(gate => gate.id === data.groups?.id);

	if (!gate) {
		return sendList(api, chatId);
	}

	const phoneNumber = gate.phoneNumbers[Number(data.groups?.phoneNumberIndex || 0)];

	api.sendMessage(chatId, `⤴️ ${gate.title}: opening…`)
		.then((message) => {
			console.log(`Open command for ${data.groups?.id} #${data.groups?.phoneNumberIndex} (${phoneNumber}) got from ${message.chat.id}.`);

			return (
				modem.send({
					message: 'ATZ',
					terminator: 'OK',
				})
					.then(() => {
						return message;
					})
			);
		})
		.then((message) => {
			return api.editMessageText(`🆙 ${gate.title}: modem connected…`, {
				chat_id: message.chat.id,
				message_id: message.message_id,
			})
				.then(() => {
					return (
						modem.send({
							message: 'AT+FCLASS=8',
							terminator: 'OK',
						})
							.then(() => {
								return message;
							})
					);
				});
		})
		.then((message) => {
			return (
				modem.send({
					message: 'ATL1',
					terminator: 'OK',
				})
					.then(() => {
						return message;
					})
			);
		})
		.then((message) => {
			return (
				modem.send({
					message: 'ATA',
				})
					.then(() => {
						return message;
					})
			);
		})
		.then((message) => {
			return (
				modem.send({
					message: 'ATH',
					terminator: 'OK',
				})
					.then(() => {
						return message;
					})
			);
		})
		.then((message) => {
			return (
				api.editMessageText(`🆓 ${gate.title}: line is free, ready to call to ${phoneNumber}…`, {
					chat_id: message.chat.id,
					message_id: message.message_id,
				})
					.then(() => {
						return modem.send({
							message: 'ATL3',
							terminator: 'OK',
						})
							.then(() => {
								return message;
							})
					})
			);
		})
		.then((message) => {
			return (
				api.editMessageText(`🆓 ${gate.title}: calling to ${phoneNumber}…`, {
					chat_id: message.chat.id,
					message_id: message.message_id,
				})
					.then(() => {
						return (
							modem.send({
								message: `ATm1x3DT${phoneNumber}`,
								terminator: 'BUSY',
							})
								.then(() => {
									return message;
								})
						)
					})
			)
		})
		.then((message) => {
			api.editMessageText(`🆗 ${gate.title} is open!`, {
				chat_id: message.chat.id,
				message_id: message.message_id,
			});

			sendList(api, message.chat.id);
		})
		.catch((error) => {
			api
				.sendMessage(chatId, `⛔ Error: ${error.message || error.toString()}`)
				.catch((error) => {
					console.error(error);
				});
		});
}

bot.addMessageProcessor((api, message) => {
	if (!['/start', '/gates', '/gate_open'].includes(message.text as string)) {
		sendList(api, message.chat.id);
		return;
	}

	openGate(api, message.chat.id, message.text as string);
});

bot.addCallbackQueryProcessor((api, query) => {
	openGate(api, query.from.id, query.data as string);
})
