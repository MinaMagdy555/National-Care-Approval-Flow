import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppSettings, TaskTypeConfig, WorkflowDefinition } from '../src/lib/types';
import { defaultAppSettings, getTaskTypeConfigs, mergeAppSettings } from '../src/lib/appSettings';

function workflow(
  id: string,
  taskTypeIds: string[] | undefined,
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    id,
    name: `${id} Workflow`,
    active: true,
    phases: [],
    taskTypeIds,
    ...overrides,
  };
}

function settings(overrides: Partial<AppSettings>): AppSettings {
  return {
    ...defaultAppSettings,
    workflows: [],
    deletedWorkflowIds: [],
    taskTypes: [],
    taskTypeWorkflowIds: {},
    ...overrides,
  };
}

test('legacy aliases do not create selectable task types', () => {
  const configs = getTaskTypeConfigs(settings({
    workflows: [workflow('creative', ['campaign'])],
    taskTypeWorkflowIds: {
      campaign: 'creative',
      stale_alias: 'creative',
    },
  }));

  assert.deepEqual(configs.map(config => config.id), ['campaign']);
});

test('dangling explicit task type metadata cannot create an option', () => {
  const dangling: TaskTypeConfig = {
    id: 'orphan',
    label: 'Orphan',
    suggestedJobTitles: ['Designer'],
    isDetailedReview: true,
    workflowId: 'missing-workflow',
  };
  const configs = getTaskTypeConfigs(settings({
    workflows: [workflow('creative', ['campaign'])],
    taskTypes: [dangling],
  }));

  assert.deepEqual(configs.map(config => config.id), ['campaign']);
});

test('inactive and deleted workflows contribute no selectable task types', () => {
  const configs = getTaskTypeConfigs(settings({
    workflows: [
      workflow('inactive', ['inactive-type'], { active: false }),
      workflow('deleted', ['deleted-type']),
    ],
    deletedWorkflowIds: ['deleted'],
  }));

  assert.deepEqual(configs, []);
});

test('matching metadata decorates a workflow-owned type with a generic name', () => {
  const metadata: TaskTypeConfig = {
    id: 'VIDEO',
    label: 'Custom Video',
    suggestedJobTitles: ['Video Editor'],
    isDetailedReview: true,
    fullReviewerUserIds: ['reviewer-1'],
    workflowId: 'creative',
  };
  const configs = getTaskTypeConfigs(settings({
    workflows: [workflow('creative', ['video'])],
    taskTypes: [metadata],
  }));

  assert.deepEqual(configs, [{
    id: 'video',
    label: 'Custom Video',
    suggestedJobTitles: ['Video Editor'],
    isDetailedReview: true,
    fullReviewerUserIds: ['reviewer-1'],
    quickLookUserIds: [],
    finalReviewerUserIds: [],
    workflowId: 'creative',
  }]);
});

test('workflow-owned task type IDs are normalized and deduplicated', () => {
  const configs = getTaskTypeConfigs(settings({
    workflows: [workflow('creative', [' Video ', 'video', 'VIDEO', 'social_media_campaigns', 'campaign'])],
  }));

  assert.deepEqual(configs.map(config => config.id), ['video', 'campaign']);
});

test('duplicate IDs across workflows keep the first owning workflow consistently', () => {
  const configs = getTaskTypeConfigs(settings({
    workflows: [
      workflow('first', [' Shared_Type ']),
      workflow('second', ['shared type']),
    ],
  }));

  assert.deepEqual(configs.map(config => ({ id: config.id, workflowId: config.workflowId })), [
    { id: 'shared type', workflowId: 'first' },
  ]);
});

test('initial migration keeps a generic type explicitly owned by a workflow', () => {
  const merged = mergeAppSettings(settings({
    workflows: [workflow('creative', ['video'])],
    taskTypeCleanupVersion: 0,
  }));

  assert.deepEqual(merged.workflows?.[0]?.taskTypeIds, ['video']);
  assert.deepEqual(getTaskTypeConfigs(merged).map(config => config.id), ['video']);
});

test('workflows with missing or empty task type IDs use their normalized name', () => {
  const configs = getTaskTypeConfigs(settings({
    workflows: [
      workflow('missing', undefined, { name: 'Product Launch' }),
      workflow('empty', [], { name: '  Design Review  ' }),
    ],
  }));

  assert.deepEqual(configs.map(config => config.id), ['product launch', 'design review']);
});

test('merge cleanup is stable across reload and retains only matching workflow metadata', () => {
  const matching: TaskTypeConfig = {
    id: 'VIDEO',
    label: 'Workflow Video',
    suggestedJobTitles: ['Video Editor'],
    isDetailedReview: true,
    workflowId: 'creative',
  };
  const stale: TaskTypeConfig = {
    id: 'old-option',
    label: 'Old Option',
    suggestedJobTitles: [],
    isDetailedReview: false,
    workflowId: 'creative',
  };
  const firstMerge = mergeAppSettings(settings({
    workflows: [workflow('creative', ['video'])],
    taskTypes: [matching, stale, 'standalone-old-option'],
    taskTypeWorkflowIds: {
      video: 'creative',
      stale_alias: 'creative',
    },
    taskTypeCleanupVersion: 2,
  }));
  const reloaded = mergeAppSettings(firstMerge);

  assert.deepEqual(firstMerge.taskTypes, [matching]);
  assert.deepEqual(reloaded.taskTypes, [matching]);
  assert.deepEqual(getTaskTypeConfigs(reloaded).map(config => ({ id: config.id, label: config.label })), [
    { id: 'video', label: 'Workflow Video' },
  ]);
});

test('standalone data produces no choices when there are no workflows', () => {
  const configs = getTaskTypeConfigs(settings({
    workflows: [],
    taskTypes: [{
      id: 'standalone',
      label: 'Standalone',
      suggestedJobTitles: [],
      isDetailedReview: false,
      workflowId: 'missing',
    }],
    taskTypeWorkflowIds: { standalone: 'missing' },
  }));

  assert.deepEqual(configs, []);
});
