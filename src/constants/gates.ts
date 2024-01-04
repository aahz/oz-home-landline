import {getEnv} from "../utility";

export const LIST = (
	String(getEnv('GATES_LIST', ''))
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

						return {
							...result,
							phoneNumbers: [...result.phoneNumbers, entry],
						};
					}, {id: '', title: '', phoneNumbers: []} as {id: string, title: string; phoneNumbers: string[]})
			);
		})
);
