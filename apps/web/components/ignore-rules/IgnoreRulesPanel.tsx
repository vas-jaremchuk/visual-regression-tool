'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  deleteIgnoreRuleAction,
  setIgnoreRuleEnabledAction,
} from '@/app/(app)/p/[slug]/ignore-rules/actions';
import { useAction } from '@/components/members/use-action';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { IgnoreRuleRow } from '@/lib/ignore-rules/queries';
import { EMPTY_DRAFT, IgnoreRuleDialog, RULE_TYPES, type RuleDraft } from './IgnoreRuleDialog';

const TYPE_LABEL = Object.fromEntries(RULE_TYPES.map((t) => [t.type, t.label.split(' (')[0]]));

/** The rule's pattern, selector or region in one line. */
export function rulePreview(rule: IgnoreRuleRow): string {
  if (rule.type === 'selector') return rule.selector ?? '';
  if (rule.type === 'region' && rule.region) {
    const { x, y, width, height } = rule.region;
    return `${width}×${height} at ${x},${y}`;
  }
  return rule.urlPattern ?? '';
}

function draftOf(rule: IgnoreRuleRow): RuleDraft {
  return {
    type: rule.type,
    urlPattern: rule.urlPattern ?? '',
    selector: rule.selector ?? '',
    region: rule.region,
    viewportSlug: rule.viewportSlug ?? '',
    appliesTo: rule.appliesTo,
    enabled: rule.enabled,
    reason: rule.reason ?? '',
  };
}

/** F-IGNORE-1: rules table with enable toggle; editors create, edit and delete. */
export function IgnoreRulesPanel({
  projectId,
  rules,
  viewports,
  canEdit,
}: {
  projectId: string;
  rules: IgnoreRuleRow[];
  viewports: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, run] = useAction();
  const [editing, setEditing] = useState<IgnoreRuleRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<IgnoreRuleRow | null>(null);

  return (
    <div className="grid gap-4">
      {canEdit && (
        <div>
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden />
            Add rule
          </Button>
        </div>
      )}
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No ignore rules. Add one here or from an item of a comparison report.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <caption className="sr-only">Ignore rules</caption>
            <thead className="bg-muted/50 text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Type
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Rule
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Viewport
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Applies to
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Enabled
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Reason
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Author
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => {
                const preview = rulePreview(rule);
                return (
                  <tr key={rule.id} className="border-t" data-testid="ignore-rule-row">
                    <td className="px-3 py-2 whitespace-nowrap">{TYPE_LABEL[rule.type]}</td>
                    <td className="px-3 py-2">
                      <span className="font-mono break-all">{preview}</span>
                      {rule.type !== 'url_pattern' && rule.urlPattern && (
                        <span className="block font-mono text-xs break-all text-muted-foreground">
                          on {rule.urlPattern}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{rule.viewportSlug ?? 'all'}</td>
                    <td className="px-3 py-2">
                      {rule.type === 'url_pattern' ? rule.appliesTo : 'n/a'}
                    </td>
                    <td className="px-3 py-2">
                      {canEdit ? (
                        <input
                          type="checkbox"
                          aria-label={`Enable rule ${preview}`}
                          checked={rule.enabled}
                          disabled={pending}
                          onChange={(e) =>
                            run(
                              () =>
                                setIgnoreRuleEnabledAction({
                                  projectId,
                                  id: rule.id,
                                  enabled: e.target.checked,
                                }),
                              router.refresh,
                            )
                          }
                        />
                      ) : (
                        <Badge variant={rule.enabled ? 'secondary' : 'outline'}>
                          {rule.enabled ? 'on' : 'off'}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{rule.reason}</td>
                    <td className="px-3 py-2 text-muted-foreground">{rule.author ?? 'unknown'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      {canEdit && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit rule ${preview}`}
                            disabled={pending}
                            onClick={() => setEditing(rule)}
                          >
                            <Pencil aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete rule ${preview}`}
                            disabled={pending}
                            onClick={() => setDeleting(rule)}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <IgnoreRuleDialog
          projectId={projectId}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          ruleId={editing === 'new' ? undefined : editing.id}
          initial={editing === 'new' ? EMPTY_DRAFT : draftOf(editing)}
          viewports={viewports}
          onSaved={router.refresh}
        />
      )}

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this ignore rule?</DialogTitle>
            <DialogDescription>
              {deleting && rulePreview(deleting)}. Finished runs and comparisons keep the rules they
              ran with.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                deleting &&
                run(
                  () => deleteIgnoreRuleAction({ projectId, id: deleting.id }),
                  () => {
                    setDeleting(null);
                    router.refresh();
                  },
                )
              }
            >
              Delete rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
