import { createModels, type FauxProviderHandle, fauxProvider, type Model, type Models } from "@earendil-works/pi-ai";

export interface FauxLlm {
	models: Models;
	model: Model<string>;
	faux: FauxProviderHandle;
}

/** faux provider 包装为可注入 AgentHarness 的 Models（不打网络）。 */
export function createFauxLlm(): FauxLlm {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	return { models, model: faux.getModel(), faux };
}
