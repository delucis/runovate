import { getSelfVersion } from '../utils/get-self-version.js';

export default async function version() {
	console.log(await getSelfVersion());
}
