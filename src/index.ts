import TelegramBot, {CallbackQuery, Message} from 'node-telegram-bot-api';
import Modem from './modem';

import * as C from './constants';

const bot = new TelegramBot(C.BOT.TOKEN, {
	polling: true,
});

const modem = new Modem({
	path: C.MODEM.PATH,
	baudRate: C.MODEM.BAUD_RATE,
	isLogEnabled: !C.ENV.IS_PRODUCTION,
	delay: 150,
});

function sendList(entity: Message | CallbackQuery): void {
	bot
		.sendMessage((entity as CallbackQuery)?.message?.chat?.id || (entity as Message)?.chat?.id, '🚧 List of available gates:', {
			reply_markup: {
				inline_keyboard: C.GATES.LIST.reduce((result, gate) => ([
					...result,
					gate.phoneNumbers.map((phoneNumber, index) => ({
						text: `${gate.title} (${phoneNumber})`,
						callback_data: `/gates open ${gate.id} ${index}`,
					})),
				]), [] as {text: string; callback_data: string}[][]),
				is_persistent: true,
			}
		})
		.then((message) => {
			console.log(`${Date.now()}: List sent to ${message.chat.id}`);
		})
		.catch((error) => {
			console.error(error);
		});
}

function openGate(entity: Message | CallbackQuery): void {
	const command = String((entity as CallbackQuery).data || (entity as Message).text);

	const data = (/^\/gates\s+open\s+(?<id>[-_a-z0-9]+)(?:\s+)?(?<phoneNumberIndex>[0-9]+)?/gi).exec(command);

	if (!C.ENV.IS_PRODUCTION) {
		console.log(`${Date.now()}: processing command "${command}"`, data);
	}

	if (!data) {
		return sendList(entity);
	}

	const gate = C.GATES.LIST.find(gate => gate.id === data.groups?.id);

	if (!gate) {
		return sendList(entity);
	}

	if (!C.ENV.IS_PRODUCTION) {
		console.log(`${Date.now()}: Found gate ${gate.id}, requested phone number ${data.groups?.phoneNumberIndex || 0}`)
	}

	const lid = Date.now();

	const phoneNumberIndex = Number(data.groups?.phoneNumberIndex || 0);
	const phoneNumber = gate.phoneNumbers[phoneNumberIndex];

	bot.sendMessage(entity.from?.id as number, `⌛ ${gate.title}: opening…`)
		.then((message) => {
			console.log(`${lid}: Open command for ${gate.id} #${phoneNumberIndex} (${phoneNumber}) got from ${message.from?.username}`);

			return (
				modem.send('ATZ', {
					terminators: ['OK'],
				})
					.then(({response}) => {
						console.log(`${lid}: Modem reset`, response.map(chunk => chunk.trim()).join(' -> '));

						return message;
					})
			);
		})
		.then((message) => {
			return bot.editMessageText(`☎️ ${gate.title}: modem connected…`, {
				chat_id: message.chat.id,
				message_id: message.message_id,
			})
				.then(() => {
					return (
						modem.send('AT+FCLASS=8', {
							terminators: ['OK'],
						})
							.then(({response}) => {
								console.log(`${lid}: Modem set to voice mode`, response.map(chunk => chunk.trim()).join(' -> '));

								return message;
							})
					);
				});
		})
		.then((message) => {
			return (
				modem.send( 'ATL1', {
					terminators: ['OK'],
				})
					.then(({response}) => {
						console.log(`${lid}: Modem set to volume level 1`, response.map(chunk => chunk.trim()).join(' -> '));

						return message;
					})
			);
		})
		.then((message) => {
			return (
				modem.send('ATA', {
					terminators: ['ATA', 'OK'],
				})
					.then(({response}) => {
						console.log(`${lid}: Modem answered to incoming call (if any)`, response.map(chunk => chunk.trim()).join(' -> '));

						return message;
					})
			);
		})
		.then((message) => {
			return (
				modem.send('ATH', {
					terminators: ['OK'],
				})
					.then(({response}) => {
						console.log(`${lid}: Modem hang up incoming call`, response.map(chunk => chunk.trim()).join(' -> '));

						return message;
					})
			);
		})
		.then((message) => {
			return (
				bot.editMessageText(`☎️ ${gate.title}: calling to ${phoneNumber}…`, {
					chat_id: message.chat.id,
					message_id: message.message_id,
				})
					.then(() => {
						return (
							modem.send(`ATm1x3DT${phoneNumber}`, {
								terminators: ['BUSY'],
								timeout: 10000,
							})
								.then(({response}) => {
									console.log(`${lid}: Modem called to ${gate.id} / ${phoneNumber}`, response.map(chunk => chunk.trim()).join(' -> '));

									return message;
								})
						)
					})
			)
		})
		.then((message) => {
			bot.editMessageText(`👍 ${gate.title}: open`, {
				chat_id: message.chat.id,
				message_id: message.message_id,
			});

			sendList(message);
		})
		.catch((error) => {
			bot
				.sendMessage(entity?.from?.id as number, `⛔ Error: ${error.message || error.toString()}`)
				.catch((error) => {
					console.error(error);
				});
		});
}

bot.on('message', (message) => {
	if (!C.BOT.ALLOWED_USER_IDS.includes(message.from?.id as number)) {
		Promise.all(
			C.BOT.ALLOWED_USER_IDS.map((userId) => bot.sendMessage(
				userId,
				[
					`Untrusted user ${message.from?.first_name} ${message.from?.last_name} (@${message.from?.username}, \`${message.from?.id}\`) trying to get access to Landline.`,
					'If you want to authorize this user tell administrator to add this user ID to white list.',
				].join(' ')
			))
		)
			.then(() => {
				bot.sendMessage(message?.chat?.id, '⛔ Error: Command not found');
			});

		return;
	}

	if ((/^\/gates\s+open\s+(?<id>[-_a-z0-9]+)(?:\s+)?(?<phoneNumberIndex>[0-9]+)?/gi).test(message.text as string)) {
		if (!C.ENV.IS_PRODUCTION) {
			console.log(`${Date.now()}: Recognized gate open request`);
		}

		return openGate(message);
	}

	if ((/^\/(?:start|gates)/gi).test(message.text as string)) {
		if (!C.ENV.IS_PRODUCTION) {
			console.log(`${Date.now()}: Recognized gates list request`);
		}

		return sendList(message);
	}
});

bot.on('callback_query', (query) => {
	if (!C.BOT.ALLOWED_USER_IDS.includes(query.from?.id as number)) {
		Promise.all(
			C.BOT.ALLOWED_USER_IDS.map((userId) => (
				bot
					.sendMessage(
						userId,
						[
							`Untrusted user ${query.from?.first_name} ${query.from?.last_name} (@${query.from?.username}, \`${query.from?.id}\`) trying to get access to Landline.`,
							'If you want to authorize this user tell administrator to add this user ID to white list.',
						].join(' ')
					)
			))
		)
			.finally(() => {
				bot
					.sendMessage(
						query?.message?.chat?.id as number,
						'⛔ Error: Command not found'
					);
			});

		return;
	}

	if ((/^\/gates\s+open\s+(?<id>[-_a-z0-9]+)(?:\s+)?(?<phoneNumberIndex>[0-9]+)?/gi).test(query.data as string)) {
		if (!C.ENV.IS_PRODUCTION) {
			console.log(`${Date.now()}: Recognized gate open query`);
		}

		return openGate(query);
	}
});
