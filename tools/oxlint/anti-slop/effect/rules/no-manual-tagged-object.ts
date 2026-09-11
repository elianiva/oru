import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

function propertyName(property: ESTree.Property): string | number | bigint | true | null | undefined {
	if (property.key.type === "Identifier" && property.computed !== true) {
		return property.key.name;
	}
	if (property.key.type === "Literal") return property.key.value;
	return undefined;
}

function hasTagField(node: ESTree.ObjectExpression): boolean {
	return node.properties.some((property) => {
		if (property.type !== "Property") return false;
		return propertyName(property) === "_tag";
	});
}

/** Tagged values must be built with the schema constructor so `_tag` cannot drift from the schema. */
export const noManualTaggedObjectRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow object literals that set `_tag`. Construct tagged values with the schema's `.make` method.",
		},
		messages: {
			manualTaggedObject:
				"Do not construct a tagged value as `{ _tag: ... }`. Use the schema constructor, for example `FooBar.make({ ... })`.",
		},
	},
	create(context) {
		return {
			ObjectExpression(node) {
				if (!hasTagField(node)) return;
				context.report({ node, messageId: "manualTaggedObject" });
			},
		};
	},
});
