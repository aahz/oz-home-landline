import {getEnv} from "../utility";

interface ListItem {
	id: string;
	title: string;
	group: string;
	phoneNumbers: string[];
}

export const RAW_LIST = String(getEnv('GATES_LIST', ''));

export const LIST = (
	RAW_LIST
		.split(';')
		.map((entry) => {
			return (
				entry
					.trim()
					.split(',')
					.reduce((result, entry, index) => {
						if (index === 0) {
							return {
								...result,
								id: entry,
							}
						}

						if (index === 1) {
							return {
								...result,
								title: entry,
							};
						}

						if (index === 2) {
							return {
								...result,
								group: entry,
							}
						}

						return {
							...result,
							phoneNumbers: [...result.phoneNumbers, entry],
						};
					}, {id: '', title: '', group: 'unknown', phoneNumbers: []} as ListItem)
			);
		})
);
