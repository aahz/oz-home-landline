import {CallbackQuery, Message} from 'node-telegram-bot-api';
import {IAppContext} from '../lib/context';
import {getChatId, getFromId} from '../lib/telegram';
import {executeDialSequence} from '../services/dial-sequence';
import * as C from '../constants';

export const COMMAND_OPEN_GATE_REGEXP = (/^\/gates\s+open\s+(?<id>[-_a-z0-9]+)(?:\s+)?(?<phoneNumberIndex>[0-9]+)?/i);

function normalizeGroup(group: string): string {
	return String(group).trim().toLowerCase();
}

function getVisibleGates(context: IAppContext, entity: Message | CallbackQuery) {
	const userId = getFromId(entity);
	const gates = context.database.listGates();

	if (!userId) {
		return [];
	}

	const user = context.database.getUserByTelegramId(userId);

	if (!user) {
		return [];
	}

	const groupSet = new Set(user.groups.map((group) => normalizeGroup(group.id)));

	const isAllGroupsEnabled = user.accessLevel === 'admin' || groupSet.has('*');

	if (isAllGroupsEnabled) {
		return gates;
	}

	return gates.filter((gate) => groupSet.has(normalizeGroup(gate.group.id)));
}

export function sendGatesList(context: IAppContext, entity: Message | CallbackQuery): void {
	const chatId = getChatId(entity);

	if (!chatId) {
		return;
	}

	const gates = getVisibleGates(context, entity);

	if (gates.length === 0) {
		context.bot.sendMessage(chatId, '🚧 Gate list is empty');

		return;
	}

	const groups = Array.from(
		gates.reduce((result, gate) => {
			const key = gate.group.id || '*';
			const name = gate.group.name || 'All groups';

			if (!result.has(key)) {
				result.set(key, {
					name,
					gates: [],
				});
			}

			result.get(key)?.gates.push(gate);

			return result;
		}, new Map<string, {name: string; gates: typeof gates}>())
	);

	let sendQueue = Promise.resolve();

	groups.forEach(([, group]) => {
		sendQueue = sendQueue
			.then(() => {
				return context.bot.sendMessage(chatId, `🚧 ${group.name}:`, {
					reply_markup: {
						inline_keyboard: group.gates.reduce((rows, gate) => ([
							...rows,
							...gate.phoneNumbers.map((phoneNumber, index) => ([{
								text: `${gate.title} ${phoneNumber}`,
								callback_data: `/gates open ${gate.id} ${index}`,
							}])),
						]), [] as {text: string; callback_data: string}[][]),
						is_persistent: true,
					},
				});
			})
			.then(() => undefined);
	});

	sendQueue
		.then(() => {
			console.log(`${Date.now()}: Grouped list sent to ${chatId}`);
		})
		.catch((error: any) => {
			console.error(error);
		});
}

export function openGate(context: IAppContext, entity: Message | CallbackQuery): void {
	const command = String((entity as CallbackQuery).data || (entity as Message).text);
	const data = COMMAND_OPEN_GATE_REGEXP.exec(command);

	if (!C.ENV.IS_PRODUCTION) {
		console.log(`${Date.now()}: processing command "${command}"`);
	}

	if (!data) {
		return sendGatesList(context, entity);
	}

	const visibleGates = getVisibleGates(context, entity);
	const gate = context.database.getGateById(data.groups?.id as string);

	if (!gate || !visibleGates.some((visibleGate) => visibleGate.id === gate.id)) {
		return sendGatesList(context, entity);
	}

	if (!C.ENV.IS_PRODUCTION) {
		console.log(`${Date.now()}: Found gate ${gate.id}, requested phone number ${data.groups?.phoneNumberIndex || 0}`)
	}

	const phoneNumberIndex = Number(data.groups?.phoneNumberIndex || 0);
	const phoneNumber = gate.phoneNumbers[phoneNumberIndex];

	if (!phoneNumber) {
		return sendGatesList(context, entity);
	}

	executeDialSequence(context, {
		entity,
		title: gate.title,
		dialTarget: phoneNumber,
		logTarget: `${gate.id} #${phoneNumberIndex} (${phoneNumber})`,
		successState: 'open',
		onSuccess: () => {
			sendGatesList(context, entity);
		},
	});
}
