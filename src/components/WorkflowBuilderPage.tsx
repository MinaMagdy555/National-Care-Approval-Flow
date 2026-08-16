import React, { useEffect, useMemo, useState } from 'react';
import { Expand, GitBranch, Layers, Minimize2, Plus, Route, Settings2, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { TaskTypeConfig, WorkflowDefinition, WorkflowNodeSubPhase, WorkflowNodeType, WorkflowPhaseDefinition } from '../lib/types';
import { cleanTaskTypeKey, normalizeSettingId } from '../lib/appSettings';
import { cn } from '../lib/utils';
import { CustomSelect } from './CustomSelect';

const NODE_W = 236;
const NODE_H = 112;
const SECTION_W = 360;
const SECTION_H = 240;
const CANVAS_W = 3400;
const CANVAS_H = 2500;
const DEFAULT_SECTION_COLOR = '#8b5cf6';
const ROOT_ID = 'workflow-root';
const UNLINKED_PARENT_ID = '__unlinked__';

type ResponsibilityVisual = {
  key: string;
  label: string;
  color: string;
  chipClass: string;
};

type WorkflowEdge = {
  id: string;
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  tone?: 'default' | 'pass' | 'fail' | 'loop';
  route?: 'parent' | 'pass' | 'fail';
};

const RESPONSIBILITY_VISUALS: ResponsibilityVisual[] = [
  { key: 'content', label: 'Content', color: '#10b981', chipClass: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  { key: 'team_leader', label: 'Team Leader', color: '#4f46e5', chipClass: 'border-indigo-200 bg-indigo-50 text-indigo-700' },
  { key: 'graphic', label: 'Graphic', color: '#ec4899', chipClass: 'border-pink-200 bg-pink-50 text-pink-700' },
  { key: 'design', label: 'Design', color: '#ec4899', chipClass: 'border-pink-200 bg-pink-50 text-pink-700' },
  { key: 'video', label: 'Video', color: '#f97316', chipClass: 'border-orange-200 bg-orange-50 text-orange-700' },
  { key: 'art_director', label: 'Art Director', color: '#7c3aed', chipClass: 'border-violet-200 bg-violet-50 text-violet-700' },
  { key: 'manager', label: 'Manager', color: '#0f766e', chipClass: 'border-teal-200 bg-teal-50 text-teal-700' },
  { key: 'marketing', label: 'Marketing', color: '#0284c7', chipClass: 'border-sky-200 bg-sky-50 text-sky-700' },
  { key: 'developer', label: 'Developer', color: '#475569', chipClass: 'border-slate-200 bg-slate-50 text-slate-700' },
  { key: 'hr', label: 'HR', color: '#db2777', chipClass: 'border-rose-200 bg-rose-50 text-rose-700' },
];

function toggleValue<T extends string>(values: T[], value: T) {
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value];
}

function makeWorkflowId(value: string) {
  return `workflow_${normalizeSettingId(value)}_${Date.now().toString(36)}`;
}

function makePhaseId(value: string) {
  return `phase_${normalizeSettingId(value)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function makeSubPhaseId(value: string) {
  return `sub_${normalizeSettingId(value)}_${Math.random().toString(36).slice(2, 7)}`;
}

function makeGroupId() {
  return `group_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function taskTypeId(config: string | TaskTypeConfig) {
  return typeof config === 'object' && config !== null ? config.id : String(config);
}

function taskTypeLabel(config: string | TaskTypeConfig) {
  return typeof config === 'object' && config !== null ? config.label : String(config);
}

function getPhasePosition(phase: WorkflowPhaseDefinition, index: number) {
  return {
    x: typeof phase.nodeX === 'number' ? phase.nodeX : 360 + index * 290,
    y: typeof phase.nodeY === 'number' ? phase.nodeY : 160,
  };
}

function getNodeSize(phase: WorkflowPhaseDefinition) {
  if (phase.nodeType === 'section' || phase.nodeType === 'note') {
    return {
      w: typeof phase.nodeWidth === 'number' ? phase.nodeWidth : phase.nodeType === 'section' ? SECTION_W : NODE_W,
      h: typeof phase.nodeHeight === 'number' ? phase.nodeHeight : phase.nodeType === 'section' ? SECTION_H : NODE_H,
    };
  }
  return { w: NODE_W, h: NODE_H };
}

function makeSubPhase(title = 'New phase'): WorkflowNodeSubPhase {
  return {
    id: makeSubPhaseId(title),
    title,
    note: '',
    responsibilityIds: [],
  };
}

function makePhase(name = 'New Step', parentPhaseId: string | null = null, x = 360, y = 160, nodeType: WorkflowNodeType = 'step'): WorkflowPhaseDefinition {
  return {
    id: makePhaseId(name),
    name,
    reviewStyle: 'quick_look',
    mode: 'sequential',
    userIds: [],
    roleIds: [],
    responsibilityIds: [],
    instructions: '',
    deliverables: [],
    delayDays: null,
    maxRevisionRounds: null,
    skipCondition: '',
    returnToPhaseId: null,
    isReviewDecision: false,
    passToPhaseId: null,
    failToPhaseId: null,
    requiredApprovals: null,
    parentPhaseId,
    parentPhaseIds: parentPhaseId ? [parentPhaseId] : [],
    nodeX: x,
    nodeY: y,
    nodeWidth: nodeType === 'section' ? SECTION_W : null,
    nodeHeight: nodeType === 'section' ? SECTION_H : null,
    nodeType,
    disabled: false,
    nodeNote: '',
    sectionColor: nodeType === 'section' ? DEFAULT_SECTION_COLOR : null,
    subPhases: nodeType === 'step' ? [makeSubPhase('What this step needs')] : [],
  };
}

function makeCampaignTemplatePhase(name: string, x: number, y: number, responsibilityIds: string[] = [], note = '') {
  return {
    ...makePhase(name, null, x, y, 'step'),
    responsibilityIds,
    nodeNote: note,
  };
}

function getSubPhaseLabel(count: number) {
  return `${count} internal phase${count === 1 ? '' : 's'}`;
}

function getResponsibilityVisual(id: string, label: string): ResponsibilityVisual {
  const text = `${id} ${label}`.toLowerCase();
  if (text.includes('senior') && text.includes('video') && (text.includes('brand') || text.includes('design'))) {
    return { key: 'design_video', label: 'Design + Video', color: '#ec4899', chipClass: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700' };
  }
  return RESPONSIBILITY_VISUALS.find(visual => text.includes(visual.key)) || {
    key: id,
    label,
    color: '#64748b',
    chipClass: 'border-slate-200 bg-slate-50 text-slate-700',
  };
}

function getNodeResponsibilityVisuals(responsibilityIds: string[], responsibilities: Array<{ id: string; label: string }>) {
  const selected = responsibilityIds
    .map(id => responsibilities.find(item => item.id === id) || { id, label: id.replace(/_/g, ' ') })
    .flatMap(item => {
      const visual = getResponsibilityVisual(item.id, item.label);
      if (visual.key === 'design_video') {
        return [
          { ...visual, key: 'graphic', label: 'Design', color: '#ec4899', chipClass: 'border-pink-200 bg-pink-50 text-pink-700' },
          { ...visual, key: 'video', label: 'Video', color: '#f97316', chipClass: 'border-orange-200 bg-orange-50 text-orange-700' },
        ];
      }
      return [{ ...visual, label: item.label }];
    });

  const unique = new Map<string, ResponsibilityVisual>();
  selected.forEach(item => unique.set(item.key, item));
  return Array.from(unique.values());
}

function getNodeColorBar(visuals: ResponsibilityVisual[]) {
  if (visuals.length === 0) return '#cbd5e1';
  if (visuals.length === 1) return visuals[0].color;
  const step = 100 / visuals.length;
  const stops = visuals.map((visual, index) => {
    const start = Math.round(index * step);
    const end = Math.round((index + 1) * step);
    return `${visual.color} ${start}% ${end}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function getPhaseStepNumbers(phases: WorkflowPhaseDefinition[]) {
  const numbers = new Map<string, number>();
  const parallelGroups = new Map<string, number>();
  let currentStep = 0;

  phases.forEach(phase => {
    if ((phase.nodeType || 'step') !== 'step') return;
    const parentId = phase.parentPhaseId || '';
    if (phase.mode === 'parallel' && parentId && parentId !== UNLINKED_PARENT_ID) {
      const groupKey = `parallel:${parentId}`;
      const existing = parallelGroups.get(groupKey);
      if (existing) {
        numbers.set(phase.id, existing);
        return;
      }
      currentStep += 1;
      parallelGroups.set(groupKey, currentStep);
      numbers.set(phase.id, currentStep);
      return;
    }
    currentStep += 1;
    numbers.set(phase.id, currentStep);
  });

  return numbers;
}

export function WorkflowBuilderPage() {
  const { appSettings, canManageSettings, updateAppSettings } = useAppStore();
  const workflows = appSettings.workflows || [];
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(workflows[0]?.id || '');
  const [newWorkflowName, setNewWorkflowName] = useState('');
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [phaseEditSnapshot, setPhaseEditSnapshot] = useState<WorkflowPhaseDefinition | null>(null);
  const [dragging, setDragging] = useState<{ id: string; dx: number; dy: number; startX: number; startY: number; movingIds?: string[]; origins?: Record<string, { x: number; y: number }> } | null>(null);
  const [isCanvasFullscreen, setIsCanvasFullscreen] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [linkingFromId, setLinkingFromId] = useState<string | null>(null);
  const [linkDrag, setLinkDrag] = useState<{ fromId: string; x1: number; y1: number; x2: number; y2: number; moved: boolean; replaceTargetId?: string | null; route?: WorkflowEdge['route'] } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [sectionBox, setSectionBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [isDrawingSection, setIsDrawingSection] = useState(false);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [deletingWorkflowId, setDeletingWorkflowId] = useState<string | null>(null);

  const selectedWorkflow = workflows.find(workflow => workflow.id === selectedWorkflowId) || workflows[0];
  const selectedWorkflowIdSafe = selectedWorkflow?.id || '';
  const editingPhase = selectedWorkflow?.phases.find(phase => phase.id === editingPhaseId) || null;

  const workflowOptions = useMemo(() => (
    workflows.map(workflow => ({
      workflow,
      taskTypeCount: (appSettings.taskTypes || []).filter(config => {
        const id = cleanTaskTypeKey(taskTypeId(config));
        return appSettings.taskTypeWorkflowIds?.[id] === workflow.id;
      }).length,
    }))
  ), [workflows, appSettings.taskTypes, appSettings.taskTypeWorkflowIds]);

  const updateWorkflow = (workflowId: string, updater: (workflow: WorkflowDefinition) => WorkflowDefinition) => {
    updateAppSettings(settings => ({
      ...settings,
      workflows: (settings.workflows || []).map(workflow => workflow.id === workflowId ? updater(workflow) : workflow),
    }));
  };

  const updateSelectedWorkflow = (updater: (workflow: WorkflowDefinition) => WorkflowDefinition) => {
    if (!selectedWorkflowIdSafe) return;
    updateWorkflow(selectedWorkflowIdSafe, workflow => ({ ...updater(workflow), updatedAt: new Date().toISOString() }));
  };

  const updatePhase = (phaseId: string, updater: (phase: WorkflowPhaseDefinition) => WorkflowPhaseDefinition) => {
    updateSelectedWorkflow(workflow => ({
      ...workflow,
      phases: workflow.phases.map(phase => phase.id === phaseId ? updater(phase) : phase),
    }));
  };

  const openPhaseEditor = (phase: WorkflowPhaseDefinition) => {
    setPhaseEditSnapshot({ ...phase, userIds: [...(phase.userIds || [])], roleIds: [...(phase.roleIds || [])], responsibilityIds: [...(phase.responsibilityIds || [])], parentPhaseIds: [...(phase.parentPhaseIds || [])], subPhases: (phase.subPhases || []).map(subPhase => ({ ...subPhase, responsibilityIds: [...(subPhase.responsibilityIds || [])] })) });
    setEditingPhaseId(phase.id);
  };

  const closePhaseEditor = () => {
    setPhaseEditSnapshot(null);
    setEditingPhaseId(null);
  };

  const cancelPhaseEditor = () => {
    if (phaseEditSnapshot) {
      updatePhase(phaseEditSnapshot.id, () => phaseEditSnapshot);
    }
    closePhaseEditor();
  };

  const deleteNode = (phase: WorkflowPhaseDefinition) => {
    if (!selectedWorkflow) return;
    const stepCount = selectedWorkflow.phases.filter(item => (item.nodeType || 'step') === 'step').length;
    if ((phase.nodeType || 'step') === 'step' && stepCount <= 1) return;
    updateSelectedWorkflow(workflow => ({
      ...workflow,
      phases: workflow.phases
        .filter(item => item.id !== phase.id)
        .map(item => {
          const nextParentIds = (item.parentPhaseIds || []).filter(id => id !== phase.id);
          const nextParentPhaseId = item.parentPhaseId === phase.id
            ? (phase.parentPhaseId === UNLINKED_PARENT_ID ? null : phase.parentPhaseId || null)
            : item.parentPhaseId;
          return {
            ...item,
            parentPhaseId: nextParentPhaseId,
            parentPhaseIds: nextParentIds,
            returnToPhaseId: item.returnToPhaseId === phase.id ? null : item.returnToPhaseId,
            passToPhaseId: item.passToPhaseId === phase.id ? null : item.passToPhaseId,
            failToPhaseId: item.failToPhaseId === phase.id ? null : item.failToPhaseId,
          };
        }),
    }));
    setSelectedNodeIds(ids => ids.filter(id => id !== phase.id));
    if (editingPhaseId === phase.id) closePhaseEditor();
  };

  const addParentLink = (targetId: string, sourceId: string) => {
    updatePhase(targetId, phase => {
      const existing = phase.parentPhaseIds && phase.parentPhaseIds.length > 0
        ? phase.parentPhaseIds
        : phase.parentPhaseId && phase.parentPhaseId !== UNLINKED_PARENT_ID ? [phase.parentPhaseId] : [];
      const nextParentIds = Array.from(new Set([...existing, sourceId]));
      return {
        ...phase,
        parentPhaseId: nextParentIds[0] || null,
        parentPhaseIds: nextParentIds,
      };
    });
  };

  const unlinkNode = (phaseId: string) => {
    updatePhase(phaseId, phase => ({ ...phase, parentPhaseId: UNLINKED_PARENT_ID, parentPhaseIds: [] }));
  };

  const removeParentLink = (targetId: string, sourceId: string) => {
    updatePhase(targetId, phase => {
      const nextParentIds = (phase.parentPhaseIds || []).filter(id => id !== sourceId);
      return {
        ...phase,
        parentPhaseId: nextParentIds[0] || (phase.parentPhaseId === sourceId ? UNLINKED_PARENT_ID : phase.parentPhaseId),
        parentPhaseIds: nextParentIds,
      };
    });
  };

  const addWorkflow = () => {
    const name = newWorkflowName.trim();
    if (!name) return;
    const now = new Date().toISOString();
    const firstPhase = makePhase('First step', null, 370, 170);
    const workflow: WorkflowDefinition = {
      id: makeWorkflowId(name),
      name,
      description: '',
      active: true,
      phases: [firstPhase],
      createdAt: now,
      updatedAt: now,
    };
    updateAppSettings(settings => ({
      ...settings,
      workflows: [...(settings.workflows || []), workflow],
      defaultWorkflowId: settings.defaultWorkflowId || workflow.id,
    }));
    setSelectedWorkflowId(workflow.id);
    setNewWorkflowName('');
  };

  const addNode = (parentPhaseId: string | null, sourcePhase?: WorkflowPhaseDefinition, nodeType: WorkflowNodeType = 'step') => {
    if (!selectedWorkflow) return;
    const sourceIndex = sourcePhase ? selectedWorkflow.phases.findIndex(phase => phase.id === sourcePhase.id) : -1;
    const sourcePos = sourcePhase ? getPhasePosition(sourcePhase, Math.max(sourceIndex, 0)) : { x: 80, y: 190 };
    const name = nodeType === 'section' ? 'Section' : nodeType === 'note' ? 'Canvas note' : 'Next step';
    const nextPhase = makePhase(name, parentPhaseId, nodeType === 'step' ? sourcePos.x + 310 : sourcePos.x + 180, nodeType === 'step' ? sourcePos.y : sourcePos.y + 180, nodeType);

    updateSelectedWorkflow(workflow => {
      const insertAt = sourceIndex >= 0 ? sourceIndex + 1 : workflow.phases.length;
      return {
        ...workflow,
        phases: [...workflow.phases.slice(0, insertAt), nextPhase, ...workflow.phases.slice(insertAt)],
      };
    });
    setPhaseEditSnapshot(nextPhase);
    setEditingPhaseId(nextPhase.id);
  };

  const toggleNodeSelection = (nodeId: string) => {
    setSelectedNodeIds(ids => ids.includes(nodeId) ? ids.filter(id => id !== nodeId) : [...ids, nodeId]);
  };

  const handleNodeSelectionMouseDown = (event: React.MouseEvent, nodeId: string) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      toggleNodeSelection(nodeId);
      return true;
    }
    setSelectedNodeIds(ids => ids.includes(nodeId) && ids.length === 1 ? ids : [nodeId]);
    return false;
  };

  const startConnectorDrag = (event: React.MouseEvent, sourceId: string, x: number, y: number) => {
    event.preventDefault();
    event.stopPropagation();
    setLinkDrag({ fromId: sourceId, x1: x, y1: y, x2: x, y2: y, moved: false });
    setLinkingFromId(sourceId);
  };

  const finishConnectorDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!linkDrag) return false;
    const target = (
      document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
    )?.closest('[data-node-id]') as HTMLElement | null;
    const targetId = target?.dataset.nodeId || '';
    if (linkDrag.moved && targetId && targetId !== linkDrag.fromId && targetId !== ROOT_ID) {
      if (linkDrag.route === 'pass') {
        updatePhase(linkDrag.fromId, phase => ({ ...phase, isReviewDecision: true, passToPhaseId: targetId }));
      } else if (linkDrag.route === 'fail') {
        updatePhase(linkDrag.fromId, phase => ({ ...phase, isReviewDecision: true, failToPhaseId: targetId, returnToPhaseId: targetId }));
      } else {
        if (linkDrag.replaceTargetId && linkDrag.replaceTargetId !== targetId) {
        removeParentLink(linkDrag.replaceTargetId, linkDrag.fromId);
        }
        addParentLink(targetId, linkDrag.fromId === ROOT_ID ? ROOT_ID : linkDrag.fromId);
      }
      setLinkDrag(null);
      setLinkingFromId(null);
      return true;
    }

    if (!linkDrag.moved) {
      if (linkDrag.fromId === ROOT_ID) {
        addNode(null, undefined, 'step');
      } else {
        const sourcePhase = selectedWorkflow?.phases.find(phase => phase.id === linkDrag.fromId);
        if (sourcePhase) addNode(sourcePhase.id, sourcePhase, 'step');
      }
    }

    setLinkDrag(null);
    setLinkingFromId(null);
    return true;
  };

  const startEdgeRewire = (event: React.MouseEvent, edge: WorkflowEdge) => {
    event.preventDefault();
    event.stopPropagation();
    setLinkDrag({
      fromId: edge.fromId,
      x1: edge.x1,
      y1: edge.y1,
      x2: edge.x2,
      y2: edge.y2,
      moved: true,
      replaceTargetId: edge.toId,
      route: edge.route || 'parent',
    });
    setLinkingFromId(edge.fromId);
  };

  const groupSelectedNodes = () => {
    if (!selectedWorkflow || selectedNodeIds.length < 2) return;
    const groupId = makeGroupId();
    updateSelectedWorkflow(workflow => ({
      ...workflow,
      phases: workflow.phases.map(phase => selectedNodeIds.includes(phase.id) && phase.nodeType !== 'section'
        ? { ...phase, groupId }
        : phase),
    }));
  };

  const createSectionFromBox = (box: { x1: number; y1: number; x2: number; y2: number }) => {
    const x = Math.min(box.x1, box.x2);
    const y = Math.min(box.y1, box.y2);
    const w = Math.abs(box.x2 - box.x1);
    const h = Math.abs(box.y2 - box.y1);
    if (w < 80 || h < 60) return;
    const name = prompt('Section name', 'Section')?.trim() || 'Section';
    const color = prompt('Section color', DEFAULT_SECTION_COLOR)?.trim() || DEFAULT_SECTION_COLOR;
    const section = {
      ...makePhase(name, null, x, y, 'section'),
      nodeWidth: Math.max(160, w),
      nodeHeight: Math.max(120, h),
      sectionColor: color,
    };
    updateSelectedWorkflow(workflow => ({ ...workflow, phases: [section, ...workflow.phases] }));
    setPhaseEditSnapshot(section);
    setEditingPhaseId(section.id);
  };

  const ungroupSelectedNodes = () => {
    if (!selectedWorkflow) return;
    const selectedGroups = new Set(selectedWorkflow.phases.filter(phase => selectedNodeIds.includes(phase.id) && phase.groupId).map(phase => phase.groupId));
    if (selectedGroups.size === 0) return;
    updateSelectedWorkflow(workflow => ({
      ...workflow,
      phases: workflow.phases.map(phase => phase.groupId && selectedGroups.has(phase.groupId)
        ? { ...phase, groupId: null }
        : phase),
    }));
  };

  const addCampaignTemplate = () => {
    const now = new Date().toISOString();
    const phases = [
      makeCampaignTemplatePhase('Campaign brief', 360, 120, ['team_leader'], 'Define category, platforms, timing, and campaign duration.'),
      makeCampaignTemplatePhase('Campaign structure', 660, 120, ['content_creator'], 'Build the structure: posts, reels, stories, and required assets.'),
      makeCampaignTemplatePhase('Structure meeting', 960, 120, ['team_leader', 'content_creator'], 'Team leader and content agree on the final structure.'),
      makeCampaignTemplatePhase('Content writing', 1260, 120, ['content_creator'], 'Write captions, scripts, TOV, and shooting list.'),
      makeCampaignTemplatePhase('Design production', 1560, 20, ['graphic_designer'], 'Design posts, stories, covers, and mockups.'),
      makeCampaignTemplatePhase('Video production', 1560, 240, ['video_editor'], 'Shooting, voice-over handoff, and video editing.'),
      makeCampaignTemplatePhase('Final creative sheet', 1860, 120, ['content_creator'], 'Collect the final assets into one creative sheet.'),
      makeCampaignTemplatePhase('Internal review', 2160, 120, ['content_creator', 'senior_brand_designer_video_editor'], 'Review all assets and route comments to the right owner.'),
      makeCampaignTemplatePhase('Make edits', 2460, 120, ['graphic_designer', 'video_editor', 'content_creator'], 'Apply requested edits until no comments remain.'),
      makeCampaignTemplatePhase('Ready for posting', 2760, 120, ['art_director', 'team_leader'], 'Notify the art director and team leader that the campaign is ready.'),
    ];
    const withParents = phases.map((phase, index) => ({ ...phase, parentPhaseId: index === 0 ? null : phases[index - 1].id }));
    const workflow: WorkflowDefinition = {
      id: makeWorkflowId('Campaign Workflow'),
      name: 'Campaign Workflow',
      description: 'Campaign planning, content, parallel creative production, review, edits, and ready-for-posting handoff.',
      active: true,
      createdAt: now,
      updatedAt: now,
      phases: withParents,
    };
    updateAppSettings(settings => ({
      ...settings,
      workflows: [...(settings.workflows || []), workflow],
      defaultWorkflowId: settings.defaultWorkflowId || workflow.id,
    }));
    setSelectedWorkflowId(workflow.id);
  };

  const deleteWorkflow = async (workflowId: string) => {
    const workflow = workflows.find(item => item.id === workflowId);
    if (!workflow || !confirm(`Delete workflow "${workflow.name}"? Existing tasks keep their saved workflow snapshot.`)) return;
    const nextSelectedWorkflowId = workflows.find(item => item.id !== workflowId)?.id || '';
    setDeletingWorkflowId(workflowId);
    try {
      await updateAppSettings(settings => {
        const nextWorkflows = (settings.workflows || []).filter(item => item.id !== workflowId);
        const nextAssignments = Object.fromEntries(Object.entries(settings.taskTypeWorkflowIds || {}).filter(([, value]) => value !== workflowId));
        const nextDeletedWorkflowIds = Array.from(new Set([...(settings.deletedWorkflowIds || []), workflowId]));
        return {
          ...settings,
          workflows: nextWorkflows,
          deletedWorkflowIds: nextDeletedWorkflowIds,
          defaultWorkflowId: settings.defaultWorkflowId === workflowId ? (nextWorkflows[0]?.id || null) : settings.defaultWorkflowId,
          taskTypeWorkflowIds: nextAssignments,
        };
      });
      setSelectedWorkflowId(nextSelectedWorkflowId);
    } finally {
      setDeletingWorkflowId(current => current === workflowId ? null : current);
    }
  };

  const getCanvasPoint = (event: React.MouseEvent, canvas: HTMLElement) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left + canvas.scrollLeft) / canvasZoom,
      y: (event.clientY - rect.top + canvas.scrollTop) / canvasZoom,
    };
  };

  const getMovementIdsForPhase = (phase: WorkflowPhaseDefinition) => {
    if (!selectedWorkflow) return [phase.id];
    if (phase.groupId) {
      return selectedWorkflow.phases.filter(item => item.groupId === phase.groupId).map(item => item.id);
    }
    if (selectedNodeIds.includes(phase.id) && selectedNodeIds.length > 1) {
      return selectedNodeIds;
    }
    return [phase.id];
  };

  const getMovementOrigins = (ids: string[]) => {
    const origins: Record<string, { x: number; y: number }> = {};
    if (!selectedWorkflow) return origins;
    ids.forEach(id => {
      const phase = selectedWorkflow.phases.find(item => item.id === id);
      if (!phase) return;
      origins[id] = getPhasePosition(phase, selectedWorkflow.phases.findIndex(item => item.id === id));
    });
    return origins;
  };

  const handleCanvasMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-node-id],button,input,textarea')) return;
    const point = getCanvasPoint(event, event.currentTarget);
    if (isDrawingSection) {
      setSectionBox({ x1: point.x, y1: point.y, x2: point.x, y2: point.y });
      return;
    }
    setSelectionBox({ x1: point.x, y1: point.y, x2: point.x, y2: point.y });
  };

  const startRootDrag = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('button,input,textarea')) return;
    const canvas = (event.currentTarget.closest('[data-node-canvas]') as HTMLElement | null);
    if (!canvas) return;
    const point = getCanvasPoint(event, canvas);
    setDragging({ id: ROOT_ID, dx: point.x - root.x, dy: point.y - root.y, startX: root.x, startY: root.y });
  };

  const editWorkflowNodeName = () => {
    if (!selectedWorkflow) return;
    const nextName = prompt('Workflow name', selectedWorkflow.name);
    if (nextName === null) return;
    const trimmed = nextName.trim();
    if (!trimmed) return;
    updateSelectedWorkflow(workflow => ({ ...workflow, name: trimmed }));
  };

  const startNodeDrag = (event: React.MouseEvent, phase: WorkflowPhaseDefinition, index: number) => {
    if (handleNodeSelectionMouseDown(event, phase.id)) return;
    if ((event.target as HTMLElement).closest('button,input,textarea')) return;
    const canvas = (event.currentTarget.closest('[data-node-canvas]') as HTMLElement | null);
    if (!canvas) return;
    const pos = getPhasePosition(phase, index);
    const point = getCanvasPoint(event, canvas);
    const movingIds = getMovementIdsForPhase(phase);
    setDragging({ id: phase.id, dx: point.x - pos.x, dy: point.y - pos.y, startX: pos.x, startY: pos.y, movingIds, origins: getMovementOrigins(movingIds) });
  };

  const handleCanvasMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (sectionBox) {
      const point = getCanvasPoint(event, event.currentTarget);
      setSectionBox(box => box ? { ...box, x2: point.x, y2: point.y } : null);
      return;
    }
    if (selectionBox) {
      const point = getCanvasPoint(event, event.currentTarget);
      setSelectionBox(box => box ? { ...box, x2: point.x, y2: point.y } : null);
      return;
    }
    if (linkDrag) {
      const point = getCanvasPoint(event, event.currentTarget);
      const distance = Math.hypot(point.x - linkDrag.x1, point.y - linkDrag.y1);
      setLinkDrag(drag => drag ? { ...drag, x2: point.x, y2: point.y, moved: drag.moved || distance > 8 } : null);
      return;
    }
    if (!dragging) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(30, (event.clientX - rect.left + event.currentTarget.scrollLeft) / canvasZoom - dragging.dx);
    const y = Math.max(30, (event.clientY - rect.top + event.currentTarget.scrollTop) / canvasZoom - dragging.dy);
    if (dragging.id === ROOT_ID) {
      updateSelectedWorkflow(workflow => ({ ...workflow, rootNodeX: Math.round(x), rootNodeY: Math.round(y) }));
      return;
    }
    if (dragging.movingIds && dragging.movingIds.length > 1 && dragging.origins) {
      const dx = x - dragging.startX;
      const dy = y - dragging.startY;
      updateSelectedWorkflow(workflow => ({
        ...workflow,
        phases: workflow.phases.map(phase => {
          const origin = dragging.origins?.[phase.id];
          if (!origin) return phase;
          return { ...phase, nodeX: Math.round(origin.x + dx), nodeY: Math.round(origin.y + dy) };
        }),
      }));
      return;
    }
    updatePhase(dragging.id, phase => ({ ...phase, nodeX: Math.round(x), nodeY: Math.round(y) }));
  };

  const handleCanvasMouseUp = (event: React.MouseEvent<HTMLDivElement>) => {
    if (finishConnectorDrag(event)) return;
    if (sectionBox) {
      createSectionFromBox(sectionBox);
      setSectionBox(null);
      setIsDrawingSection(false);
      return;
    }
    if (selectionBox && selectedWorkflow) {
      const x1 = Math.min(selectionBox.x1, selectionBox.x2);
      const x2 = Math.max(selectionBox.x1, selectionBox.x2);
      const y1 = Math.min(selectionBox.y1, selectionBox.y2);
      const y2 = Math.max(selectionBox.y1, selectionBox.y2);
      const selectedIds = selectedWorkflow.phases.filter(phase => {
        if (phase.nodeType === 'section') return false;
        const index = selectedWorkflow.phases.findIndex(item => item.id === phase.id);
        const pos = getPhasePosition(phase, index);
        const size = getNodeSize(phase);
        return pos.x + size.w >= x1 && pos.x <= x2 && pos.y + size.h >= y1 && pos.y <= y2;
      }).map(phase => phase.id);
      setSelectedNodeIds(selectedIds);
      setSelectionBox(null);
      return;
    }
    setDragging(null);
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key.toLowerCase() === 'g' && event.ctrlKey && event.shiftKey) {
        event.preventDefault();
        ungroupSelectedNodes();
        return;
      }
      if (event.key.toLowerCase() === 'g' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        groupSelectedNodes();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedNodeIds, selectedWorkflowIdSafe, selectedWorkflow?.phases]);

  if (!canManageSettings) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm font-bold text-slate-500">
          Workflow Builder is available only to configured settings managers.
        </div>
      </div>
    );
  }

  const root = {
    x: typeof selectedWorkflow?.rootNodeX === 'number' ? selectedWorkflow.rootNodeX : 60,
    y: typeof selectedWorkflow?.rootNodeY === 'number' ? selectedWorkflow.rootNodeY : 200,
    w: 220,
    h: 100,
  };
  const phases = selectedWorkflow?.phases || [];
  const stepCount = phases.filter(phase => (phase.nodeType || 'step') === 'step').length;
  const canDeleteWorkflowNode = (phase: WorkflowPhaseDefinition) => phase.nodeType !== 'step' || stepCount > 1;
  const phaseStepNumbers = getPhaseStepNumbers(phases);
  const groupBounds = Array.from(new Set(phases.map(phase => phase.groupId).filter(Boolean) as string[])).map(groupId => {
    const groupPhases = phases.filter(phase => phase.groupId === groupId && phase.nodeType !== 'section');
    const boxes = groupPhases.map(phase => {
      const pos = getPhasePosition(phase, phases.findIndex(item => item.id === phase.id));
      const size = getNodeSize(phase);
      return { x: pos.x, y: pos.y, w: size.w, h: size.h };
    });
    if (boxes.length === 0) return null;
    const minX = Math.min(...boxes.map(box => box.x));
    const minY = Math.min(...boxes.map(box => box.y));
    const maxX = Math.max(...boxes.map(box => box.x + box.w));
    const maxY = Math.max(...boxes.map(box => box.y + box.h));
    return { id: groupId, x: minX - 20, y: minY - 28, w: maxX - minX + 40, h: maxY - minY + 56, count: boxes.length };
  }).filter((item): item is { id: string; x: number; y: number; w: number; h: number; count: number } => Boolean(item));
  const getNodeAnchor = (nodeId: string, side: 'left' | 'right') => {
    if (nodeId === ROOT_ID) {
      return { x: side === 'right' ? root.x + root.w : root.x, y: root.y + root.h / 2 };
    }
    const phase = phases.find(item => item.id === nodeId);
    if (!phase) return { x: root.x + root.w, y: root.y + root.h / 2 };
    const index = phases.findIndex(item => item.id === nodeId);
    const pos = getPhasePosition(phase, index);
    const size = getNodeSize(phase);
    return { x: side === 'right' ? pos.x + size.w : pos.x, y: pos.y + size.h / 2 };
  };

  const parentEdges: WorkflowEdge[] = phases
    .flatMap((phase, index) => {
      if (phase.parentPhaseId === UNLINKED_PARENT_ID || (phase.nodeType || 'step') !== 'step') return [];
      const parentIds = phase.parentPhaseIds && phase.parentPhaseIds.length > 0
        ? phase.parentPhaseIds
        : [phase.parentPhaseId || (index === 0 ? ROOT_ID : phases[index - 1].id)];
      return parentIds.filter(parentId => parentId && parentId !== UNLINKED_PARENT_ID).map(parentId => {
        const from = getNodeAnchor(parentId, 'right');
        const to = getNodeAnchor(phase.id, 'left');
        return { id: `parent:${parentId}:${phase.id}`, fromId: parentId, toId: phase.id, x1: from.x, y1: from.y, x2: to.x, y2: to.y, tone: 'default' as const, route: 'parent' as const };
      });
    });
  const decisionEdges: WorkflowEdge[] = phases.flatMap(phase => {
    if ((phase.nodeType || 'step') !== 'step') return [];
    const edges: WorkflowEdge[] = [];
    const routeTargets: Array<{ id?: string | null; tone: WorkflowEdge['tone']; key: string }> = [
      { id: phase.passToPhaseId, tone: 'pass', key: 'pass' },
      { id: phase.failToPhaseId || phase.returnToPhaseId, tone: 'fail', key: 'fail' },
    ];
    routeTargets.forEach(route => {
      if (!route.id || route.id === phase.id) return;
      const from = getNodeAnchor(phase.id, 'right');
      const targetPos = getNodeAnchor(route.id, 'left');
      edges.push({ id: `${route.key}:${phase.id}:${route.id}`, fromId: phase.id, toId: route.id, x1: from.x, y1: from.y + (route.key === 'fail' ? 18 : -18), x2: targetPos.x, y2: targetPos.y + (route.key === 'fail' ? 18 : -18), tone: route.tone, route: route.key as WorkflowEdge['route'] });
    });
    return edges;
  });
  const edges = [...parentEdges, ...decisionEdges];
  const phaseTargetOptions = [
    { value: '', label: 'None' },
    ...phases
      .filter(phase => phase.id !== editingPhase?.id && (phase.nodeType || 'step') === 'step')
      .map(phase => ({ value: phase.id, label: phase.name })),
  ];
  const passTargetOptions = [
    { value: '', label: 'Automatic next step' },
    ...phases
      .filter(phase => phase.id !== editingPhase?.id && (phase.nodeType || 'step') === 'step')
      .map(phase => ({ value: phase.id, label: phase.name })),
  ];
  const skipRuleOptions = [
    { value: 'none', label: 'Never (always run)' },
    { value: 'manual', label: 'Manual skip by permitted user' },
    { value: 'if_no_task_links', label: 'If task has no assignment links' },
    { value: 'if_no_files_in_previous_version', label: 'If previous version has no files' },
  ];

  return (
    <div className="mx-auto max-w-[1800px] space-y-5 overflow-x-hidden px-4 pb-6 pt-0 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <Route className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-black text-slate-950">Workflow Builder</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">Mind-map canvas for steps, ownership responsibilities, notes, and internal phases.</p>
        </div>
        <div className="grid w-full gap-2 sm:grid-cols-[1fr,auto] lg:w-[560px]">
          <input value={newWorkflowName} onChange={event => setNewWorkflowName(event.target.value)} placeholder="New workflow name" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
          <button type="button" onClick={addWorkflow} disabled={!newWorkflowName.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-slate-300">
            <Plus className="h-4 w-4" /> Create Workflow
          </button>
          <button type="button" onClick={addCampaignTemplate} className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-black text-indigo-700 transition-colors hover:bg-indigo-100 sm:col-span-2">
            <GitBranch className="h-4 w-4" /> Add Campaign Template
          </button>
        </div>
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[300px,minmax(0,1fr)]">
        <aside className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">Workflows</h2>
            <p className="mt-1 text-xs font-semibold text-slate-400">Select a workflow to open its map.</p>
          </div>
          <div className="space-y-2">
            {workflowOptions.map(({ workflow, taskTypeCount }) => (
              <div key={workflow.id} className={cn("flex w-full items-start gap-2 rounded-xl border p-2 transition-colors", selectedWorkflow?.id === workflow.id ? "border-indigo-200 bg-indigo-50 text-indigo-900" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")}>
                <button type="button" onClick={() => setSelectedWorkflowId(workflow.id)} className="min-w-0 flex-1 rounded-lg p-1 text-left outline-none focus:ring-2 focus:ring-indigo-500/30">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-black">{workflow.name}</span>
                    {appSettings.defaultWorkflowId === workflow.id && <span className="shrink-0 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">Default</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wide text-slate-400">
                    <span>{workflow.phases.filter(phase => phase.nodeType !== 'note').length} steps</span>
                    <span>{workflow.phases.filter(phase => phase.nodeType === 'note').length} notes</span>
                    <span>{taskTypeCount} task types</span>
                    <span>{workflow.active === false ? 'Disabled' : 'Active'}</span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => void deleteWorkflow(workflow.id)}
                  disabled={deletingWorkflowId === workflow.id}
                  className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-600 shadow-sm hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-500/20 disabled:cursor-wait disabled:opacity-50"
                  title={`Delete ${workflow.name}`}
                  aria-label={`Delete ${workflow.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        {selectedWorkflow ? (
          <section className="min-w-0 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid gap-3 lg:grid-cols-[1.2fr,1.8fr,auto] lg:items-end">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Workflow Name
                  <input value={selectedWorkflow.name} onChange={event => updateSelectedWorkflow(workflow => ({ ...workflow, name: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-black text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
                </label>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Description / Intent
                  <input value={selectedWorkflow.description || ''} onChange={event => updateSelectedWorkflow(workflow => ({ ...workflow, description: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => updateAppSettings(settings => ({ ...settings, defaultWorkflowId: selectedWorkflow.id }))} className={cn("rounded-xl border px-3 py-2.5 text-xs font-black", appSettings.defaultWorkflowId === selectedWorkflow.id ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-700")}>{appSettings.defaultWorkflowId === selectedWorkflow.id ? 'Default' : 'Set Default'}</button>
                  <button type="button" onClick={() => updateSelectedWorkflow(workflow => ({ ...workflow, active: workflow.active === false }))} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-black text-slate-700">{selectedWorkflow.active === false ? 'Enable' : 'Disable'}</button>
                  <button type="button" onClick={() => void deleteWorkflow(selectedWorkflow.id)} disabled={deletingWorkflowId === selectedWorkflow.id} className="rounded-xl border border-rose-200 bg-white px-3 py-2.5 text-xs font-black text-rose-600 hover:bg-rose-50 disabled:cursor-wait disabled:opacity-50">{deletingWorkflowId === selectedWorkflow.id ? 'Deleting...' : 'Delete'}</button>
                </div>
              </div>
              <div className="mt-4 border-t border-slate-100 pt-4">
                <h3 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">Use For Task Types</h3>
                <div className="flex flex-wrap gap-2">
                  {(appSettings.taskTypes || []).map(config => {
                    const id = cleanTaskTypeKey(taskTypeId(config));
                    const active = appSettings.taskTypeWorkflowIds?.[id] === selectedWorkflow.id;
                    return <button key={id} type="button" onClick={() => updateAppSettings(settings => ({ ...settings, taskTypeWorkflowIds: { ...(settings.taskTypeWorkflowIds || {}), [id]: active ? '' : selectedWorkflow.id } }))} className={cn("rounded-full border px-3 py-1 text-xs font-black", active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>{taskTypeLabel(config)}{active ? ` uses ${selectedWorkflow.name}` : ''}</button>;
                  })}
                </div>
              </div>
            </div>

            <div className={cn("overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm", isCanvasFullscreen && "fixed inset-0 z-50 rounded-none border-0")}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <div>
                  <h2 className="text-sm font-black uppercase tracking-wider text-slate-500">Node Canvas</h2>
                    <p className="text-xs font-semibold text-slate-400">Drag nodes anywhere. Use plus handles to connect or rewire arrows.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => groupSelectedNodes()} disabled={selectedNodeIds.length < 2} className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-black text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40"><Layers className="h-4 w-4" /> Group</button>
                  <button type="button" onClick={() => setIsDrawingSection(value => !value)} className={cn("inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-black", isDrawingSection ? "border-violet-300 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-700 hover:bg-violet-50")}><Layers className="h-4 w-4" /> {isDrawingSection ? 'Draw Section' : 'Add Section'}</button>
                  <button type="button" onClick={() => addNode(null, undefined, 'note')} className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-black text-amber-700 hover:bg-amber-100"><Plus className="h-4 w-4" /> Add Note</button>
                  <button type="button" onClick={() => addNode(null)} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white hover:bg-indigo-700"><Plus className="h-4 w-4" /> Add Step</button>
                </div>
              </div>
              <div data-node-canvas="true" className={cn("relative select-none overflow-auto bg-slate-50", isCanvasFullscreen ? "h-[calc(100vh-73px)]" : "h-[680px]", isDrawingSection && "cursor-crosshair")} onMouseDown={handleCanvasMouseDown} onMouseMove={handleCanvasMove} onMouseUp={handleCanvasMouseUp} onMouseLeave={() => { setDragging(null); setLinkDrag(null); setSelectionBox(null); setSectionBox(null); }}>
                <div className="sticky left-3 top-3 z-40 flex w-fit flex-wrap gap-2 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur">
                  <button type="button" onClick={() => setIsCanvasFullscreen(value => !value)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-700 hover:bg-slate-50">
                    {isCanvasFullscreen ? <Minimize2 className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
                    {isCanvasFullscreen ? 'Exit' : 'Full'}
                  </button>
                  <button type="button" onClick={() => setCanvasZoom(value => Math.max(0.5, Number((value - 0.1).toFixed(2))))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"><ZoomOut className="h-4 w-4" /></button>
                  <span className="flex h-9 min-w-14 items-center justify-center rounded-lg border border-slate-200 px-2 text-xs font-black text-slate-600">{Math.round(canvasZoom * 100)}%</span>
                  <button type="button" onClick={() => setCanvasZoom(value => Math.min(1.6, Number((value + 0.1).toFixed(2))))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"><ZoomIn className="h-4 w-4" /></button>
                  {linkingFromId && <button type="button" onClick={() => { setLinkingFromId(null); setLinkDrag(null); }} className="h-9 rounded-lg border border-rose-200 px-3 text-xs font-black text-rose-600 hover:bg-rose-50">Cancel Linking</button>}
                </div>
                <div className="relative" style={{ width: CANVAS_W * canvasZoom, height: CANVAS_H * canvasZoom }}>
                <div className="relative" style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${canvasZoom})`, transformOrigin: '0 0' }}>
                  {selectionBox && <div className="pointer-events-none absolute z-50 rounded-lg border border-indigo-400 bg-indigo-500/10" style={{ left: Math.min(selectionBox.x1, selectionBox.x2), top: Math.min(selectionBox.y1, selectionBox.y2), width: Math.abs(selectionBox.x2 - selectionBox.x1), height: Math.abs(selectionBox.y2 - selectionBox.y1) }} />}
                  {sectionBox && <div className="pointer-events-none absolute z-50 rounded-2xl border-2 border-dashed border-violet-500 bg-violet-500/10" style={{ left: Math.min(sectionBox.x1, sectionBox.x2), top: Math.min(sectionBox.y1, sectionBox.y2), width: Math.abs(sectionBox.x2 - sectionBox.x1), height: Math.abs(sectionBox.y2 - sectionBox.y1) }} />}
                  <svg className="pointer-events-none absolute inset-0 h-full w-full">
                    <defs>
                      <marker id="workflow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
                        <path d="M 0 0 L 8 4 L 0 8 z" fill="#94a3b8" />
                      </marker>
                      <marker id="workflow-arrow-pass" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
                        <path d="M 0 0 L 8 4 L 0 8 z" fill="#10b981" />
                      </marker>
                      <marker id="workflow-arrow-fail" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
                        <path d="M 0 0 L 8 4 L 0 8 z" fill="#f43f5e" />
                      </marker>
                    </defs>
                    {edges.map(edge => {
                      const stroke = edge.tone === 'pass' ? '#10b981' : edge.tone === 'fail' ? '#f43f5e' : '#c7d2fe';
                      const marker = edge.tone === 'pass' ? 'url(#workflow-arrow-pass)' : edge.tone === 'fail' ? 'url(#workflow-arrow-fail)' : 'url(#workflow-arrow)';
                      return <path key={edge.id} d={`M ${edge.x1} ${edge.y1} C ${edge.x1 + 90} ${edge.y1}, ${edge.x2 - 90} ${edge.y2}, ${edge.x2} ${edge.y2}`} fill="none" stroke={stroke} strokeDasharray={edge.tone === 'fail' ? '7 6' : undefined} strokeWidth="3" markerEnd={marker} />;
                    })}
                    {linkDrag && <path d={`M ${linkDrag.x1} ${linkDrag.y1} C ${linkDrag.x1 + 90} ${linkDrag.y1}, ${linkDrag.x2 - 90} ${linkDrag.y2}, ${linkDrag.x2} ${linkDrag.y2}`} fill="none" stroke="#2563eb" strokeDasharray="8 6" strokeWidth="3" markerEnd="url(#workflow-arrow)" />}
                  </svg>
                  {edges.map(edge => {
                    const midX = (edge.x1 + edge.x2) / 2;
                    const midY = (edge.y1 + edge.y2) / 2;
                    return (
                      <button
                        key={`rewire-${edge.id}`}
                        type="button"
                        onMouseDown={event => startEdgeRewire(event, edge)}
                        className="absolute z-20 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-indigo-200 bg-white text-[10px] font-black text-indigo-600 shadow hover:bg-indigo-50"
                        style={{ left: midX, top: midY }}
                        title="Drag to rewire this arrow"
                      >
                        <Settings2 className="h-3 w-3" />
                      </button>
                    );
                  })}
                  {groupBounds.map(group => (
                    <div key={group.id} className="pointer-events-none absolute z-[1] rounded-2xl border-2 border-dashed border-violet-400 bg-violet-500/5" style={{ left: group.x, top: group.y, width: group.w, height: group.h }}>
                      <span className="absolute left-3 top-2 rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">Group ({group.count})</span>
                    </div>
                  ))}

                  <div data-node-id={ROOT_ID} onDoubleClick={editWorkflowNodeName} onMouseDown={startRootDrag} className={cn("absolute cursor-grab rounded-2xl border-2 border-indigo-200 bg-indigo-600 p-4 text-white shadow-lg transition-shadow hover:shadow-xl", dragging?.id === ROOT_ID && "shadow-2xl ring-2 ring-indigo-300")} style={{ left: root.x, top: root.y, width: root.w, height: root.h }}>
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-indigo-100"><GitBranch className="h-4 w-4" /> Workflow</div>
                    <div className="mt-2 truncate text-lg font-black">{selectedWorkflow.name}</div>
                    <button type="button" onClick={editWorkflowNodeName} className="absolute bottom-2 right-2 rounded-lg border border-white/30 bg-white/10 px-2 py-1 text-[10px] font-black text-white hover:bg-white/20">Edit</button>
                    <button type="button" onMouseDown={event => startConnectorDrag(event, ROOT_ID, root.x + root.w, root.y + root.h / 2)} onClick={event => event.preventDefault()} className="absolute right-2 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-indigo-600 text-white shadow-md hover:bg-indigo-700"><Plus className="h-4 w-4" /></button>
                  </div>

                  {phases.map((phase, index) => {
                    const pos = getPhasePosition(phase, index);
                    const isNote = phase.nodeType === 'note';
                    const isSection = phase.nodeType === 'section';
                    const nodeSize = getNodeSize(phase);
                    const selected = selectedNodeIds.includes(phase.id);
                    const moving = dragging?.movingIds?.includes(phase.id);
                    const subPhaseCount = phase.subPhases?.length || 0;
                    const responsibilityVisuals = getNodeResponsibilityVisuals(phase.responsibilityIds || [], appSettings.responsibilities);
                    const colorBar = isSection ? '#8b5cf6' : isNote ? '#f59e0b' : getNodeColorBar(responsibilityVisuals);
                    const stepNumber = phaseStepNumbers.get(phase.id) || index + 1;
                    if (isSection) {
                      return (
                        <div key={phase.id} data-node-id={phase.id} onDoubleClick={() => openPhaseEditor(phase)} onMouseDown={event => startNodeDrag(event, phase, index)} className={cn("absolute z-0 cursor-grab rounded-2xl border-2 border-dashed p-4 shadow-sm transition-shadow hover:shadow-md", dragging?.id === phase.id && "ring-2 ring-violet-300", selected && "ring-2 ring-violet-300")} style={{ left: pos.x, top: pos.y, width: nodeSize.w, height: nodeSize.h, borderColor: phase.sectionColor || DEFAULT_SECTION_COLOR, backgroundColor: `${phase.sectionColor || DEFAULT_SECTION_COLOR}1A` }}>
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-violet-600"><Layers className="h-3.5 w-3.5" /> Section</div>
                              <div className="text-base font-black text-violet-950">{phase.name}</div>
                              <p className="mt-1 max-w-sm text-xs font-semibold text-violet-700">{phase.nodeNote || 'Use this as a visual section for related nodes.'}</p>
                            </div>
                            {selected && <span className="rounded-lg border border-violet-300 bg-violet-600 px-2 py-1 text-[10px] font-black text-white">Selected</span>}
                          </div>
                          <div className="absolute bottom-3 right-3 flex gap-1">
                            <button type="button" onClick={() => openPhaseEditor(phase)} className="rounded-lg border border-violet-200 bg-white px-2 py-1 text-[10px] font-black text-violet-700">Edit</button>
                            <button type="button" onClick={() => deleteNode(phase)} disabled={!canDeleteWorkflowNode(phase)} className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-[10px] font-black text-rose-600 disabled:opacity-40">Delete</button>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={phase.id} data-node-id={phase.id} onDoubleClick={() => openPhaseEditor(phase)} onMouseDown={event => startNodeDrag(event, phase, index)} className={cn("absolute z-10 cursor-grab rounded-2xl border bg-white p-3 pt-4 shadow-sm transition-shadow hover:shadow-lg", isNote && "bg-amber-50", dragging?.id === phase.id || moving ? "border-indigo-400 shadow-xl" : "border-slate-200", selected && "border-indigo-500 ring-2 ring-indigo-200", linkingFromId === phase.id && "ring-2 ring-blue-300", phase.disabled && "opacity-55")} style={{ left: pos.x, top: pos.y, width: nodeSize.w, minHeight: nodeSize.h }}>
                        <div className="absolute inset-x-0 top-0 h-1.5 rounded-t-2xl" style={{ background: colorBar }} />
                        <div className="mb-2 flex flex-wrap gap-1">
                          <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-white", isNote ? "bg-amber-600" : "bg-slate-900")}>{isNote ? 'Note' : `Step ${stepNumber}`}</span>
                          {!isNote && <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide", phase.mode === 'parallel' ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-600")}>{phase.mode === 'parallel' ? 'Parallel' : 'After Previous'}</span>}
                          {phase.groupId && <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-violet-700">Grouped</span>}
                          {phase.disabled && <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-rose-700">Disabled</span>}
                          {!isNote && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-slate-600">{getSubPhaseLabel(subPhaseCount)}</span>}
                        </div>
                        <div className="truncate text-sm font-black text-slate-950">{phase.name}</div>
                        <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-snug text-slate-500">{phase.nodeNote || (isNote ? 'Free canvas note' : 'No node note yet')}</p>
                        {!isNote && (
                          <div className="mt-2">
                            <div className="mb-1 text-[9px] font-black uppercase tracking-wide text-slate-400">Responsible For</div>
                            <div className="flex flex-wrap gap-1">
                              {responsibilityVisuals.length > 0 ? responsibilityVisuals.slice(0, 3).map(visual => (
                                <span key={visual.key} className={cn("max-w-full truncate rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide", visual.chipClass)}>{visual.label}</span>
                              )) : (
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-slate-500">Not set</span>
                              )}
                              {responsibilityVisuals.length > 3 && <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-slate-500">+{responsibilityVisuals.length - 3}</span>}
                            </div>
                          </div>
                        )}
                        <div className="mt-3 flex flex-wrap gap-1">
                          {selected && <span className="rounded-lg border border-indigo-300 bg-indigo-600 px-2 py-1 text-[10px] font-black text-white">Selected</span>}
                          <button type="button" onClick={() => openPhaseEditor(phase)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-600 hover:text-indigo-600">Edit</button>
                          <button type="button" onClick={() => updatePhase(phase.id, item => ({ ...item, disabled: !item.disabled }))} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-600">{phase.disabled ? 'Enable' : 'Disable'}</button>
                          <button type="button" onClick={() => deleteNode(phase)} disabled={!canDeleteWorkflowNode(phase)} className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-[10px] font-black text-rose-600 disabled:opacity-40">Delete</button>
                        </div>
                        {!isNote && <button type="button" onMouseDown={event => startConnectorDrag(event, phase.id, pos.x + nodeSize.w, pos.y + nodeSize.h / 2)} onClick={event => event.preventDefault()} className="absolute right-2 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-indigo-200 bg-white text-indigo-600 shadow hover:bg-indigo-50"><Plus className="h-4 w-4" /></button>}
                      </div>
                    );
                  })}
                </div>
                </div>
              </div>
            </div>
            </section>
        ) : <section className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">Create your first workflow to start building.</section>}
      </div>

      {editingPhase && selectedWorkflow && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-slate-900/50 backdrop-blur-sm" onClick={cancelPhaseEditor}>
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-100 bg-white px-5 py-4">
              <div>
                <h2 className="text-lg font-black text-slate-950">{editingPhase.nodeType === 'section' ? 'Edit Section' : editingPhase.nodeType === 'note' ? 'Edit Canvas Note' : 'Edit Step Node'}</h2>
                <p className="text-xs font-semibold text-slate-500">Nodes define the step, the responsible work area, and internal notes.</p>
              </div>
              <button type="button" onClick={cancelPhaseEditor} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-5 p-5">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Node Name
                <input value={editingPhase.name} onChange={event => updatePhase(editingPhase.id, phase => ({ ...phase, name: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-black text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
              </label>
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Node Note
                <textarea value={editingPhase.nodeNote || ''} onChange={event => updatePhase(editingPhase.id, phase => ({ ...phase, nodeNote: event.target.value, instructions: event.target.value }))} rows={4} placeholder="Write what this node means, what should happen here, or any context for the team." className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold leading-relaxed text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
              </label>

              {editingPhase.nodeType === 'section' && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Section Color
                    <input type="color" value={editingPhase.sectionColor || DEFAULT_SECTION_COLOR} onChange={event => updatePhase(editingPhase.id, phase => ({ ...phase, sectionColor: event.target.value }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white p-1" />
                  </label>
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Section Width
                    <input type="number" min={240} value={editingPhase.nodeWidth ?? SECTION_W} onChange={event => updatePhase(editingPhase.id, phase => ({ ...phase, nodeWidth: Number(event.target.value) || SECTION_W }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-slate-900" />
                  </label>
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Section Height
                    <input type="number" min={160} value={editingPhase.nodeHeight ?? SECTION_H} onChange={event => updatePhase(editingPhase.id, phase => ({ ...phase, nodeHeight: Number(event.target.value) || SECTION_H }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-slate-900" />
                  </label>
                </div>
              )}

              {editingPhase.nodeType === 'step' && (
                <>
                  <div>
                    <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400">Step Flow</span>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button type="button" onClick={() => updatePhase(editingPhase.id, phase => ({ ...phase, mode: 'sequential' }))} className={cn("rounded-xl border px-3 py-3 text-left transition-colors", editingPhase.mode !== 'parallel' ? "border-indigo-200 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>
                        <span className="block text-sm font-black">After Previous</span>
                        <span className="mt-1 block text-xs font-semibold opacity-75">This step waits for the previous step.</span>
                      </button>
                      <button type="button" onClick={() => updatePhase(editingPhase.id, phase => ({ ...phase, mode: 'parallel' }))} className={cn("rounded-xl border px-3 py-3 text-left transition-colors", editingPhase.mode === 'parallel' ? "border-blue-200 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>
                        <span className="block text-sm font-black">Parallel</span>
                        <span className="mt-1 block text-xs font-semibold opacity-75">Sibling branches run together and share one step number.</span>
                      </button>
                    </div>
                  </div>
                  <TokenPanel title="Responsibilities" items={appSettings.responsibilities.map(responsibility => ({ id: responsibility.id, label: responsibility.label }))} selectedIds={editingPhase.responsibilityIds || []} onToggle={id => updatePhase(editingPhase.id, phase => ({ ...phase, responsibilityIds: toggleValue(phase.responsibilityIds || [], id) }))} />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Start Delay Days
                      <input
                        type="number"
                        min={0}
                        value={editingPhase.delayDays ?? ''}
                        onChange={event => updatePhase(editingPhase.id, phase => ({ ...phase, delayDays: event.target.value === '' ? null : Math.max(0, Number(event.target.value) || 0) }))}
                        placeholder="0"
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                      />
                    </label>
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Skip Rule
                      <CustomSelect
                        value={editingPhase.skipRule || 'none'}
                        options={skipRuleOptions}
                        onChange={value => updatePhase(editingPhase.id, phase => ({ ...phase, skipRule: value as WorkflowPhaseDefinition['skipRule'] }))}
                        buttonClassName="mt-1 rounded-xl px-3 py-2.5 text-sm font-black"
                      />
                    </label>
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Fail / Return Target
                      <CustomSelect
                        value={editingPhase.failToPhaseId || editingPhase.returnToPhaseId || ''}
                        options={phaseTargetOptions}
                        onChange={value => updatePhase(editingPhase.id, phase => ({ ...phase, failToPhaseId: value || null, returnToPhaseId: value || null }))}
                        buttonClassName="mt-1 rounded-xl px-3 py-2.5 text-sm font-black"
                      />
                    </label>
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Required Approvals
                      <input
                        type="number"
                        min={1}
                        value={editingPhase.requiredApprovals ?? ''}
                        onChange={event => updatePhase(editingPhase.id, phase => ({ ...phase, requiredApprovals: event.target.value === '' ? null : Math.max(1, Number(event.target.value) || 1) }))}
                        placeholder="Defaults to all assigned reviewers"
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                      />
                    </label>
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Pass / Skip Note
                      <input
                        value={editingPhase.skipCondition || ''}
                        onChange={event => updatePhase(editingPhase.id, phase => ({ ...phase, skipCondition: event.target.value }))}
                        placeholder="Example: Skip if no video assets"
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                      />
                    </label>
                  </div>

                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={Boolean(editingPhase.isReviewDecision)}
                        onChange={event => updatePhase(editingPhase.id, phase => ({ ...phase, isReviewDecision: event.target.checked }))}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>
                        <span className="block text-sm font-black text-indigo-950">Review decision routing</span>
                        <span className="mt-1 block text-xs font-semibold leading-relaxed text-indigo-700">Use this when the step should branch: approved work follows one route, requested changes return to another step.</span>
                      </span>
                    </label>
                    {editingPhase.isReviewDecision && (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <label className="text-[10px] font-black uppercase tracking-wider text-indigo-400">If Approved
                          <CustomSelect
                            value={editingPhase.passToPhaseId || ''}
                            options={passTargetOptions}
                            onChange={value => updatePhase(editingPhase.id, phase => ({ ...phase, passToPhaseId: value || null }))}
                            buttonClassName="mt-1 rounded-xl px-3 py-2.5 text-sm font-black"
                          />
                        </label>
                        <label className="text-[10px] font-black uppercase tracking-wider text-indigo-400">If Changes Needed
                          <CustomSelect
                            value={editingPhase.failToPhaseId || editingPhase.returnToPhaseId || ''}
                            options={phaseTargetOptions}
                            onChange={value => updatePhase(editingPhase.id, phase => ({ ...phase, failToPhaseId: value || null, returnToPhaseId: value || null }))}
                            buttonClassName="mt-1 rounded-xl px-3 py-2.5 text-sm font-black"
                          />
                        </label>
                      </div>
                    )}
                  </div>

                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Handoff Rule
                    <textarea
                      value={editingPhase.instructions || editingPhase.nodeNote || ''}
                      onChange={event => updatePhase(editingPhase.id, phase => ({ ...phase, instructions: event.target.value }))}
                      rows={3}
                      placeholder="Example: When content finishes, this node starts for the designer/video editor."
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold leading-relaxed text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </label>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-black text-slate-900">Internal Phases</h3>
                        <p className="text-xs font-semibold text-slate-500">Use these to describe what each team or unit does inside this node.</p>
                      </div>
                      <button type="button" onClick={() => updatePhase(editingPhase.id, phase => ({ ...phase, subPhases: [...(phase.subPhases || []), makeSubPhase('New internal phase')] }))} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white hover:bg-indigo-700"><Plus className="h-3.5 w-3.5" /> Add Phase</button>
                    </div>
                    <div className="space-y-3">
                      {(editingPhase.subPhases || []).map((subPhase, index) => (
                        <SubPhaseEditor key={subPhase.id} index={index} subPhase={subPhase} responsibilities={appSettings.responsibilities.map(responsibility => ({ id: responsibility.id, label: responsibility.label }))} onChange={nextSubPhase => updatePhase(editingPhase.id, phase => ({ ...phase, subPhases: (phase.subPhases || []).map(item => item.id === subPhase.id ? nextSubPhase : item) }))} onDelete={() => updatePhase(editingPhase.id, phase => ({ ...phase, subPhases: (phase.subPhases || []).filter(item => item.id !== subPhase.id) }))} />
                      ))}
                      {(editingPhase.subPhases || []).length === 0 && <div className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-center text-xs font-bold text-slate-400">No internal phases yet.</div>}
                    </div>
                  </div>
                </>
              )}

              <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-4">
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => unlinkNode(editingPhase.id)} disabled={editingPhase.parentPhaseId === UNLINKED_PARENT_ID && (editingPhase.parentPhaseIds || []).length === 0} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 disabled:opacity-40">Break Link</button>
                  <button type="button" onClick={() => updatePhase(editingPhase.id, phase => ({ ...phase, disabled: !phase.disabled }))} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700">{editingPhase.disabled ? 'Enable Node' : 'Disable Node'}</button>
                  <button type="button" onClick={() => deleteNode(editingPhase)} disabled={!canDeleteWorkflowNode(editingPhase)} className="rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-black text-rose-600 disabled:opacity-40"><Trash2 className="mr-2 inline h-4 w-4" />Delete Node</button>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={cancelPhaseEditor} className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50">Cancel</button>
                  <button type="button" onClick={closePhaseEditor} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-black text-white hover:bg-indigo-700">Save Changes</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TokenPanel({ title, items, selectedIds, onToggle }: { title: string; items: Array<{ id: string; label: string }>; selectedIds: string[]; onToggle: (id: string) => void }) {
  return (
    <div>
      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400">{title}</span>
      <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-slate-100 bg-white p-2">
        {items.map(item => {
          const active = selectedIds.includes(item.id);
          return <button key={item.id} type="button" onClick={() => onToggle(item.id)} className={cn("rounded-full border px-2 py-1 text-[11px] font-bold", active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>{item.label}</button>;
        })}
      </div>
    </div>
  );
}

interface SubPhaseEditorProps {
  index: number;
  subPhase: WorkflowNodeSubPhase;
  responsibilities: Array<{ id: string; label: string }>;
  onChange: (subPhase: WorkflowNodeSubPhase) => void;
  onDelete: () => void;
}

const SubPhaseEditor: React.FC<SubPhaseEditorProps> = ({ index, subPhase, responsibilities, onChange, onDelete }) => {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-white">Phase {index + 1}</span>
        <button type="button" onClick={onDelete} className="rounded-lg border border-rose-200 px-2 py-1 text-[10px] font-black text-rose-600">Delete</button>
      </div>
      <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Phase Title
        <input value={subPhase.title} onChange={event => onChange({ ...subPhase, title: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
      </label>
      <label className="mt-3 block text-[10px] font-black uppercase tracking-wider text-slate-400">What Happens Here
        <textarea value={subPhase.note} onChange={event => onChange({ ...subPhase, note: event.target.value })} rows={3} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold leading-relaxed text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
      </label>
      <div className="mt-3">
        <TokenPanel title="Responsibilities For This Phase" items={responsibilities} selectedIds={subPhase.responsibilityIds || []} onToggle={id => onChange({ ...subPhase, responsibilityIds: toggleValue(subPhase.responsibilityIds || [], id) })} />
      </div>
    </div>
  );
};
