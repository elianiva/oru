import { eslintCompatPlugin } from "@oxlint/plugins";

import { noManualTaggedObjectRule } from "./rules/no-manual-tagged-object.ts";
import { noServiceConstructorImportsRule } from "./rules/no-service-constructor-imports.ts";

/** Opt-in Oxlint rules for Effect service and Layer architecture. */
const antiSlopEffectPlugin = eslintCompatPlugin({
	meta: { name: "anti-slop-effect" },
	rules: {
		"no-manual-tagged-object": noManualTaggedObjectRule,
		"no-service-constructor-imports": noServiceConstructorImportsRule,
	},
});

export default antiSlopEffectPlugin;
