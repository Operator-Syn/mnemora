"use strict";
// Mounted over n8n's shipped rule at
//   dist/modules/breaking-changes/rules/v3/workflow-import-url-removed.rule.js
// so the migration report stops listing an item it can never stop listing by itself.
//
// The shipped detect() returns isAffected: true with no condition, no instance state and no feature
// flag, and the rule is instance-level — migration_finding only triages workflow-level rules
// (its statuses are open/notified/fixed/fixed_unpublished/wont_fix), so there is no wont_fix row
// that could retire this one. The choices were: live with a permanent notice, pin n8n 2.x forever,
// or override the rule. The capability is already replaced at the CLI
// (./scripts/workflows.sh import-url), so the notice reports a loss we have covered.
//
// This is a VENDOR PATCH, re-checked whenever N8N_VERSION changes by
// scripts/check-n8n-overrides.py:
//   - if n8n drops or renames this file, the mount becomes an inert extra file and the notice comes
//     back — loud, not silently wrong;
//   - if the class shape changes, registration or boot throws — equally loud.
//
// It does NOT restore the editor feature. Import-from-URL is gone from n8n 3.x; the CLI replacement
// is the capability, this only silences the report line about it.

// Copied verbatim from the shipped file: n8n compiles with legacy TypeScript decorators, and the
// helper (not a bare decorator call) is what the registry ends up seeing.
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};

Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowImportUrlRemovedRule = void 0;
const decorators_1 = require("@n8n/decorators");

let WorkflowImportUrlRemovedRule = class WorkflowImportUrlRemovedRule {
    constructor() {
        this.id = 'workflow-import-url-removed-v3';
    }
    getMetadata() {
        return {
            version: 'v3',
            title: 'Workflow import from URL is removed',
            description: 'The "Import from URL" option in the editor is removed.',
            category: "instance",
            impact: 'capabilityRemoved',
        };
    }
    // Suppressed deliberately — see the header. Nothing on this instance can act on it any more:
    // the replacement is ./scripts/workflows.sh import-url, which fetches, risk-scans, then imports.
    async detect() {
        return {
            isAffected: false,
            instanceIssues: [],
            recommendations: [],
        };
    }
};

exports.WorkflowImportUrlRemovedRule = WorkflowImportUrlRemovedRule;
exports.WorkflowImportUrlRemovedRule = WorkflowImportUrlRemovedRule = __decorate([
    (0, decorators_1.BreakingChangeRule)({ version: 'v3' })
], WorkflowImportUrlRemovedRule);
