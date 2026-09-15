import { eslintCompatPlugin } from "@oxlint/plugins";

import { noEffectInternalTagsRule } from "./rules/no-effect-internal-tags.ts";
import { noErrorConstructorRule } from "./rules/no-error-constructor.ts";
import { noManualTagEqualityRule } from "./rules/no-manual-tag-equality.ts";
import { noManualTaggedObjectRule } from "./rules/no-manual-tagged-object.ts";
import { noServiceConstructorImportsRule } from "./rules/no-service-constructor-imports.ts";

const antiSlopEffectPlugin = eslintCompatPlugin({
	meta: { name: "anti-slop-effect" },
	rules: {
		"no-effect-internal-tags": noEffectInternalTagsRule,
		"no-error-constructor": noErrorConstructorRule,
		"no-manual-tag-equality": noManualTagEqualityRule,
		"no-manual-tagged-object": noManualTaggedObjectRule,
		"no-service-constructor-imports": noServiceConstructorImportsRule,
	},
});

export default antiSlopEffectPlugin;
