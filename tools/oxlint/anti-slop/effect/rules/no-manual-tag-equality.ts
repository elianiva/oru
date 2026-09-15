import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

function isTagAccess(node: ESTree.Expression): boolean {
	if (node.type !== "MemberExpression" || node.computed === true) return false;
	if (node.property.type === "Identifier") return node.property.name === "_tag";
	return node.property.type === "Literal" && node.property.value === "_tag";
}

export const noManualTagEqualityRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow equality checks on `_tag`. Use Match.tagsExhaustive, Match.tag, Schema.is, or Predicate.isTagged.",
		},
		messages: {
			manualTagEquality:
				"Do not compare `_tag`. Use Match.tagsExhaustive / Match.tag, Schema.is, or Predicate.isTagged.",
		},
	},
	create(context) {
		return {
			BinaryExpression(node) {
				if (!["===", "!==", "==", "!="].includes(node.operator)) return;
				if (isTagAccess(node.left) || isTagAccess(node.right)) {
					context.report({ node, messageId: "manualTagEquality" });
				}
			},
		};
	},
});
