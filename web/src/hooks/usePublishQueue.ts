import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useContextStore } from '@/hooks/use-context-store';
import { useAuth } from '@/hooks/use-auth';
import { useAppLogStore } from '@/store/app-log-store';
import { DEFAULT_SETTINGS } from '@/types/settings';
import type { AppSettings } from '@/types/settings';

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number((bytes / Math.pow(k, i)).toFixed(1))} ${['B', 'KB', 'MB', 'GB'][i]}`;
}

interface UploadReportEntry {
    name: string;
    s3Key: string;
    size: number;
    status: 'ok' | 'error';
}

function logPublishReport(
    addLog: (level: 'info' | 'warn' | 'error', msg: string) => void,
    elementName: string,
    versionLabel: string,
    entries: UploadReportEntry[],
    totalBytes: number
) {
    const okCount = entries.filter((e) => e.status === 'ok').length;
    const errCount = entries.filter((e) => e.status === 'error').length;
    addLog('info', '─────────────────────────────────────────');
    addLog('info', `📋 PUBLISH REPORT: ${elementName} (${versionLabel})`);
    addLog('info', '─────────────────────────────────────────');
    entries.forEach((e) => {
        const status = e.status === 'ok' ? '✓' : '✗';
        const sizeStr = formatBytes(e.size);
        addLog('info', `  ${status} ${e.name}: ${sizeStr} → ${e.s3Key}`);
    });
    addLog('info', '─────────────────────────────────────────');
    addLog('info', `  Total: ${formatBytes(totalBytes)} | OK: ${okCount} | Failed: ${errCount}`);
    addLog('info', '─────────────────────────────────────────');
}

function sanitizeTrackingNumber(value: string | null | undefined): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (trimmed === '' || trimmed === '—') return null;
    return trimmed;
}

async function notifyShotPublishRecipients(params: {
    actorId: string;
    projectId: string;
    shotId: string;
    taskId?: string | null;
    versionId?: string | null;
    type: 'version_submitted' | 'element_published';
    granularType: 'my_version_created' | 'my_element_published';
    title: string;
    message: string;
    explicitRecipientIds?: string[];
}): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id || session.user.id !== params.actorId) {
        console.warn('[NOTIFY] Skipped: no valid session or actor mismatch (required for rpc_notify_recipients)');
        return;
    }

    const { data: shotRow } = await supabase.from('shots').select('artist_id').eq('id', params.shotId).single();
    const { data: pmRows } = await supabase
        .from('project_members')
        .select('user_id')
        .eq('project_id', params.projectId)
        .in('role', ['supervisor', 'manager', 'production', 'admin']);
    const { data: taskRows } = await supabase
        .from('shot_tasks')
        .select('assigned_to')
        .eq('shot_id', params.shotId)
        .not('assigned_to', 'is', null);
    const recipientIds = new Set<string>();
    (params.explicitRecipientIds || []).forEach((id) => recipientIds.add(id));
    if (shotRow?.artist_id) recipientIds.add(shotRow.artist_id);
    (pmRows || []).forEach((r: { user_id: string }) => recipientIds.add(r.user_id));
    (taskRows || []).forEach((r: { assigned_to: string | null }) => {
        if (r.assigned_to) recipientIds.add(r.assigned_to);
    });
    const finalRecipientIds = Array.from(recipientIds);
    if (!finalRecipientIds.length) return;

    const { data: prefs } = await supabase
        .from('notification_preferences')
        .select('user_id, enabled')
        .eq('notification_type', params.granularType)
        .in('user_id', finalRecipientIds);
    const disabled = new Set((prefs || []).filter((p: { enabled: boolean }) => p.enabled === false).map((p: { user_id: string }) => p.user_id));
    const filteredRecipientIds = finalRecipientIds.filter((id) => !disabled.has(id));
    if (!filteredRecipientIds.length) return;

    const payload = {
        p_type: params.type,
        p_title: params.title,
        p_message: params.message,
        p_recipient_ids: filteredRecipientIds,
        p_actor_id: params.actorId,
        p_project_id: params.projectId,
        p_shot_id: params.shotId,
        p_task_id: params.taskId ?? null,
        p_version_id: params.versionId ?? null,
        p_note_id: null
    };
    const { error } = await supabase.rpc('rpc_notify_recipients', payload);
    if (!error) return;

    const errMsg = error.message || String(error);
    const errCode = (error as { code?: string })?.code;
    console.warn(`[NOTIFY] rpc_notify_recipients failed: code=${errCode ?? 'unknown'}, message=${errMsg}`);

    if (params.type === 'element_published') {
        const { error: fallbackError } = await supabase.rpc('rpc_notify_recipients', {
            ...payload,
            p_type: 'version_submitted'
        });
        if (!fallbackError) return;
        throw fallbackError;
    }
    throw error;
}

/** Matches bulk ingest path: Projects/{project}/{episodeCode}/{sequenceName}/{shotCode} (no Episodes/Sequences/Shots segments). */
function buildShotRootPath(projectCode: string, sequenceName: string, shotCode: string, episodeCode?: string | null): string {
    const episodePart = episodeCode ? `/${episodeCode}` : '';
    return `Projects/${projectCode}${episodePart}/${sequenceName}/${shotCode}`;
}

/** Builds S3/MinIO object key. Result must be a file key (no trailing slash) so the object is stored as a file, not shown as a folder. */
function joinPathSegment(basePath: string, segment: string): string {
    const normalizedBase = basePath.replace(/\/+$/, '');
    const normalizedSegment = segment.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!normalizedSegment) return normalizedBase;
    return `${normalizedBase}/${normalizedSegment}`;
}

async function resolveCanonicalPathContext(params: {
    projectId: string;
    shotId: string;
    projectCode?: string | null;
    sequenceName?: string | null;
    shotCode?: string | null;
    episodeCode?: string | null;
}): Promise<{ projectCode: string | null; sequenceName: string | null; shotCode: string | null; episodeCode: string | null }> {
    const resolved = {
        projectCode: params.projectCode ?? null,
        sequenceName: params.sequenceName ?? null,
        shotCode: params.shotCode ?? null,
        episodeCode: params.episodeCode ?? null
    };
    const needsLookup = !resolved.projectCode || !resolved.sequenceName || !resolved.shotCode;
    if (!needsLookup) return resolved;
    const { data: shotRow } = await supabase
        .from('shots')
        .select('shot_code, sequence_name, episode_id')
        .eq('id', params.shotId)
        .single();
    const { data: projectRow } = await supabase
        .from('projects')
        .select('code')
        .eq('id', params.projectId)
        .single();
    if (!resolved.shotCode) resolved.shotCode = shotRow?.shot_code ?? null;
    if (!resolved.sequenceName) resolved.sequenceName = shotRow?.sequence_name ?? null;
    if (!resolved.projectCode) resolved.projectCode = projectRow?.code ?? null;
    if (!resolved.episodeCode && shotRow?.episode_id) {
        const { data: episodeRow } = await supabase
            .from('episodes')
            .select('code')
            .eq('id', shotRow.episode_id)
            .maybeSingle();
        resolved.episodeCode = episodeRow?.code ?? null;
    }
    return resolved;
}

export type PublishStatus = 'idle' | 'transcoding' | 'uploading' | 'submitting' | 'completed' | 'error';

export type PublishTab = 'element' | 'version';

export interface PublishJobMeta {
    tab: PublishTab;
    elementLabel?: string;
    elementNotes?: string;
    elementCategory?: string;
    elementType?: string;
    deliveryType?: string;
    submissionNotes?: string;
    notifyUserIds?: string[];
    versionOverride?: boolean;
    versionName?: string;
    trackingNumber?: string | null;
    frameStart?: number;
    frameEnd?: number;
    frameRange?: string;
    storagePlan?: {
        shotRootPath?: string;
        versionsBasePath?: string;
        elementsBasePath?: string;
        sourceFrameRange?: {
            start: number;
            end: number;
            count?: number | null;
        };
    };
}

export interface PublishJob {
    id: string;
    filePath: string;
    status: PublishStatus;
    progress: number;
    error?: string;
    context?: {
        projectId: string | null;
        projectCode?: string | null;
        episodeCode?: string | null;
        shotId: string | null;
        shotCode?: string | null;
        sequenceName?: string | null;
        taskId: string | null;
        taskName?: string | null;
        trackingNumber?: string | null;
    };
    options?: {
        burnin?: boolean;
        gif?: boolean;
        metadata?: Record<string, string>;
    };
    meta?: PublishJobMeta;
}

export type JobEventLevel = 'info' | 'warn' | 'error';
export type JobEventComponent = 'renderer' | 'main' | 'python' | 's3' | 'db' | 'queue';
export type JobEventType = 'log' | 'started' | 'progress' | 'completed' | 'failed' | 'heartbeat';

export interface QueueLogEventInput {
    jobId: string;
    message: string;
    level?: JobEventLevel;
    component?: JobEventComponent;
    stage?: string;
    eventType?: JobEventType;
    payload?: Record<string, unknown>;
    runId?: string | null;
    attempt?: number;
}

export function usePublishQueue() {
    const [queue, setQueue] = useState<PublishJob[]>([]);
    const { projectId, projectCode, episodeCode, shotId, shotCode: ctxShotCode, sequenceName, taskId, elementCategory, elementType } = useContextStore();
    const { user, profile } = useAuth();
    const addLog = useAppLogStore((s) => s.addLog);

    // 1. Initial Load from SQLite
    useEffect(() => {
        (window as any).ipcRenderer.invoke('queue:get-jobs').then((jobs: any[]) => {
            const mapped = jobs.map((j) => {
                let meta: PublishJobMeta | undefined;
                try {
                    if (j.meta && typeof j.meta === 'string') meta = JSON.parse(j.meta) as PublishJobMeta;
                } catch (_) { /* ignore */ }
                return {
                    id: j.id,
                    filePath: j.file_path,
                    status: j.status as PublishStatus,
                    progress: j.progress,
                    error: j.error,
                    context: {
                        projectId: j.project_id,
                        shotId: j.shot_id,
                        shotCode: j.shot_code,
                        taskId: j.task_id,
                        taskName: j.task_name || "Task",
                        trackingNumber: j.tracking_number
                    },
                    meta,
                    size: j.size || 0
                };
            });
            setQueue(prev => {
                const loadedIds = new Set(mapped.map(j => j.id));
                const added = prev.filter(j => !loadedIds.has(j.id));
                return [...mapped, ...added];
            });
        });
    }, []);

    // 2. Track currently processing job for log attribution
    const [activeJobId, setActiveJobId] = useState<string | null>(null);
    const activeJobRunRef = useRef<Record<string, string>>({});
    const uploadProgressRef = useRef<Record<string, number>>({});
    const processNextJobRef = useRef<() => void>();

    // 3. Listen for Python logs and attribute to active job
    useEffect(() => {
        const ipc = (window as any).ipcRenderer;
        if (!ipc?.on) return;
        const handler = (_event: any, msg: string) => {
            addLog('info', `[PYTHON] ${msg}`);
            if (activeJobId) {
                const runId = activeJobRunRef.current[activeJobId] ?? null;
                ipc.invoke('queue:add-event', {
                    job_id: activeJobId,
                    run_id: runId,
                    attempt: 1,
                    level: 'info',
                    component: 'python',
                    stage: 'python',
                    event_type: 'log',
                    message: msg,
                    payload_json: null
                });
            }
        };
        const unsubscribe = ipc.on('python-log', handler);
        return () => {
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, [addLog, activeJobId]);

    useEffect(() => {
        const ipc = (window as any).ipcRenderer;
        if (!ipc?.on) return;
        const handler = (_event: any, data: { key: string; progress: number }) => {
            if (!activeJobId) return;
            const prev = uploadProgressRef.current[activeJobId] ?? 0;
            const next = Number(data.progress || 0);
            if (next < 100 && next - prev < 10) return;
            uploadProgressRef.current[activeJobId] = next;
            const runId = activeJobRunRef.current[activeJobId] ?? null;
            ipc.invoke('queue:add-event', {
                job_id: activeJobId,
                run_id: runId,
                attempt: 1,
                level: 'info',
                component: 's3',
                stage: 'upload',
                event_type: 'progress',
                message: `Upload progress ${next}%`,
                payload_json: JSON.stringify({ key: data.key, progress: next })
            });
        };
        const unsubscribe = ipc.on('upload-progress', handler);
        return () => {
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, [activeJobId]);

    // 4. Check Dependencies on startup
    useEffect(() => {
        (window as any).ipcRenderer.invoke('python-command', { command: 'check_dependencies' })
            .then((res: any) => {
                if (res.status === 'success' && res.missing && res.missing.length > 0) {
                    const missing = res.missing as string[];
                    addLog('error', `[DEPENDENCY] Missing Python modules: ${missing.join(', ')}`);
                    if (confirm(`The following Python modules are missing: ${missing.join(', ')}. Would you like to install them now?`)) {
                        addLog('info', `[DEPENDENCY] Installing ${missing.join(', ')}...`);
                        (window as any).ipcRenderer.invoke('python:install-deps', { modules: missing })
                            .then((stdout: string) => {
                                addLog('info', `[DEPENDENCY] Installation complete: ${stdout}`);
                                alert('Dependencies installed successfully. Please restart processing if needed.');
                            })
                            .catch((err: any) => {
                                addLog('error', `[DEPENDENCY] Installation failed: ${err}`);
                                alert(`Failed to install dependencies: ${err}`);
                            });
                    }
                } else if (res.status === 'success') {
                    addLog('info', `[DEPENDENCY] All Python dependencies verified.`);
                }
            })
            .catch((err: any) => {
                addLog('error', `[DEPENDENCY] Failed to check dependencies: ${err}`);
            });
    }, [addLog]);

    const addJob = useCallback((filePath: string, options?: PublishJob['options'], meta?: PublishJobMeta, customContext?: { projectId?: string | null, projectCode?: string | null, episodeCode?: string | null, shotId?: string | null, shotCode?: string | null, sequenceName?: string | null, taskId?: string | null, taskName?: string | null, trackingNumber?: string | null }): string => {
        const id = Math.random().toString(36).substring(7);
        const context = {
            projectId: customContext?.projectId ?? projectId,
            projectCode: customContext?.projectCode ?? projectCode,
            episodeCode: customContext?.episodeCode ?? episodeCode,
            shotId: customContext?.shotId ?? shotId,
            shotCode: customContext?.shotCode ?? ctxShotCode,
            sequenceName: customContext?.sequenceName ?? sequenceName,
            taskId: customContext?.taskId ?? taskId,
            taskName: customContext?.taskName ?? null,
            trackingNumber: customContext?.trackingNumber ?? null
        };

        const newJob: PublishJob = {
            id,
            filePath,
            status: 'idle',
            progress: 0,
            options,
            context: {
                projectId: context.projectId,
                projectCode: context.projectCode,
                episodeCode: context.episodeCode,
                shotId: context.shotId,
                shotCode: context.shotCode,
                sequenceName: context.sequenceName,
                taskId: context.taskId,
                taskName: context.taskName,
                trackingNumber: context.trackingNumber
            },
            meta
        };

        setQueue(prev => [...prev, newJob]);

        const ipc = (window as any).ipcRenderer;
        ipc.invoke('queue:add-job', {
            id: newJob.id,
            file_path: newJob.filePath,
            status: newJob.status,
            progress: newJob.progress,
            project_id: context.projectId,
            shot_id: context.shotId,
            shot_code: context.shotCode,
            task_id: context.taskId,
            task_name: context.taskName,
            tracking_number: context.trackingNumber,
            meta: meta ? JSON.stringify(meta) : null
        }).then(() => {
            ipc.invoke('queue:add-event', {
                job_id: newJob.id,
                run_id: null,
                attempt: 1,
                level: 'info',
                component: 'queue',
                stage: 'queued',
                event_type: 'started',
                message: 'Job queued',
                payload_json: JSON.stringify({
                    filePath: newJob.filePath,
                    tab: meta?.tab ?? 'version',
                    shotCode: context.shotCode ?? null,
                    trackingNumber: context.trackingNumber ?? null
                })
            });
        }).catch((err: unknown) => {
            console.error('Failed to persist queued job event', err);
        });

        return id;
    }, [projectId, projectCode, episodeCode, shotId, ctxShotCode, sequenceName, taskId]);

    const updateJob = useCallback((id: string, updates: Partial<PublishJob>) => {
        setQueue(prev => prev.map(job => job.id === id ? { ...job, ...updates } : job));

        const dbUpdates: any = {};
        if (updates.status) dbUpdates.status = updates.status;
        if (updates.progress !== undefined) dbUpdates.progress = updates.progress;
        if (updates.error) dbUpdates.error = updates.error;

        if (Object.keys(dbUpdates).length > 0) {
            (window as any).ipcRenderer.invoke('queue:update-job', { id, updates: dbUpdates });
        }
    }, []);

    const addJobEvent = useCallback((event: QueueLogEventInput) => {
        const runId = event.runId ?? activeJobRunRef.current[event.jobId] ?? null;
        (window as any).ipcRenderer.invoke('queue:add-event', {
            job_id: event.jobId,
            run_id: runId,
            attempt: event.attempt ?? 1,
            level: event.level ?? 'info',
            component: event.component ?? 'renderer',
            stage: event.stage ?? null,
            event_type: event.eventType ?? 'log',
            message: event.message,
            payload_json: event.payload ? JSON.stringify(event.payload) : null
        });
    }, []);

    const addJobLog = useCallback((jobId: string, message: string, extras?: Omit<QueueLogEventInput, 'jobId' | 'message'>) => {
        addJobEvent({
            jobId,
            message,
            level: extras?.level,
            component: extras?.component,
            stage: extras?.stage,
            eventType: extras?.eventType,
            payload: extras?.payload,
            runId: extras?.runId,
            attempt: extras?.attempt
        });
    }, [addJobEvent]);

    const getJobLogs = useCallback(async (jobId: string) => {
        return (window as any).ipcRenderer.invoke('queue:get-logs', jobId);
    }, []);

    const getJobEvents = useCallback(async (jobId: string, limit: number = 1000) => {
        return (window as any).ipcRenderer.invoke('queue:get-events', { jobId, limit });
    }, []);

    const startPublish = useCallback(async (jobId?: string) => {
        if (!jobId) {
            const idleJobs = queue.filter(j => j.status === 'idle');
            for (const job of idleJobs) {
                await startPublish(job.id);
            }
            return;
        }

        const job = queue.find(j => j.id === jobId);
        if (!job || !job.context?.shotId || !job.context?.projectId || !user?.id) return;
        const pId = job.context.projectId as string;
        const sId = job.context.shotId as string;
        let projectCode = job.context?.projectCode ?? null;
        let sequenceName = job.context?.sequenceName ?? null;
        let shotCode = job.context?.shotCode ?? null;
        let resolvedEpisodeCode = job.context?.episodeCode ?? null;
        const hasStoragePlanRoot = Boolean(job.meta?.storagePlan?.shotRootPath);
        if (!hasStoragePlanRoot) {
            const canonical = await resolveCanonicalPathContext({
                projectId: pId,
                shotId: sId,
                projectCode,
                sequenceName,
                shotCode,
                episodeCode: resolvedEpisodeCode
            });
            projectCode = canonical.projectCode;
            sequenceName = canonical.sequenceName;
            shotCode = canonical.shotCode;
            resolvedEpisodeCode = canonical.episodeCode;
        }
        const shotCodeLabel = shotCode ?? 'SHOT';
        if (!hasStoragePlanRoot && (!projectCode || !sequenceName || !shotCode)) {
            updateJob(jobId, {
                status: 'error',
                error: 'Missing project/sequence/shot context for canonical storage path'
            });
            addJobLog(jobId, 'ERROR: Missing canonical path context (projectCode, sequenceName, shotCode)', {
                component: 'queue',
                stage: 'path',
                eventType: 'failed',
                level: 'error'
            });
            setTimeout(() => processNextJobRef.current?.(), 0);
            return;
        }

        const fileName = job.filePath.split(/[\\/]/).pop() ?? job.filePath;
        addLog('info', `[CONTEXT] Shot: ${shotCode ?? 'UNKNOWN'} (${sId}) | Project: ${projectCode ?? 'UNKNOWN'} (${pId})`);
        addLog('info', `[START] Publishing version: ${fileName}`);
        const runId = `${jobId}-${Date.now()}`;
        activeJobRunRef.current[jobId] = runId;
        uploadProgressRef.current[jobId] = 0;
        addJobLog(jobId, `Starting publish for ${fileName}`, {
            runId,
            component: 'renderer',
            stage: 'queue',
            eventType: 'started'
        });
        setActiveJobId(jobId);
        let resolvedFrameStart = job.meta?.frameStart ?? job.meta?.storagePlan?.sourceFrameRange?.start;
        let resolvedFrameEnd = job.meta?.frameEnd ?? job.meta?.storagePlan?.sourceFrameRange?.end;
        const isInputVideoFile = /\.(mp4|mov|avi|mkv|mxf)$/i.test(job.filePath);

        // If single video file (MP4/MOV) and no frame range, read metadata from file (ProRes/H.264/H.265 — free data)
        const isSingleVideoFile = isInputVideoFile && resolvedFrameStart == null && resolvedFrameEnd == null;
        if (isSingleVideoFile) {
            try {
                const videoMeta = await (window as any).ipcRenderer.invoke('video-metadata', job.filePath);
                if (videoMeta?.frameStart != null && videoMeta?.frameEnd != null) {
                    resolvedFrameStart = videoMeta.frameStart;
                    resolvedFrameEnd = videoMeta.frameEnd;
                    addJobLog(jobId, `Read frame range from file: ${resolvedFrameStart}–${resolvedFrameEnd} (${videoMeta.frameCount} frames)`, { runId, component: 'renderer', stage: 'metadata', eventType: 'log' });
                }
            } catch (e) {
                // Non-fatal; continue with null frame range
            }
        }

        // Track temporary files for cleanup
        const cleanupFiles: string[] = [];

        try {
            updateJob(jobId, { status: 'transcoding', progress: 10 });
            addJobLog(jobId, "Transcoding media...", {
                runId,
                component: 'python',
                stage: 'transcode',
                eventType: 'started'
            });

            const appSettings: AppSettings = await (window as any).ipcRenderer.invoke('settings:read').then((s: Partial<AppSettings> | null) => ({
                ...DEFAULT_SETTINGS,
                ...s
            }));

            const rawTaskName = job.context?.taskName || "Task";
            const taskName = (rawTaskName !== "Other" && rawTaskName !== "") ? rawTaskName.replace(/\s+/g, '') : "Task";

            // Get temp directory from main process
            const tempDir = await (window as any).ipcRenderer.invoke('app:get-temp-path');
            const outputBaseName = `${shotCodeLabel}_${taskName}_${job.id}`; // Add job ID to avoid collisions

            // Generate paths in temp dir
            const mp4Path = `${tempDir}\\${outputBaseName}.mp4`;
            const webpPath = `${tempDir}\\${outputBaseName}.webp`;
            const thumbOutputDir = `${tempDir}\\${outputBaseName}_thumbs`;

            // Register for cleanup
            cleanupFiles.push(mp4Path);

            addLog('info', `[GENERATE] MP4 first (chunked if long sequence), then WebP + thumbnails from MP4: ${mp4Path}`);
            let transcodeResult: { status: string; output?: string };
            let webpResult: { status: string; output?: string } | null = null;
            let thumbnailsResult: { thumbnail?: string; webp?: string } | null = null;

            if (job.options?.gif !== false) {
                cleanupFiles.push(webpPath);
                const transcodeInputPath = !isInputVideoFile && resolvedFrameStart != null && resolvedFrameEnd != null
                    ? job.filePath.replace(/(\d+)(\.\w+)$/, '%04d$2')
                    : job.filePath;
                const pythonResult = await (window as any).ipcRenderer.invoke('python-command', {
                    command: 'transcode_then_webp_thumb',
                    params: {
                        input_path: transcodeInputPath,
                        mp4_path: mp4Path,
                        webp_path: webpPath,
                        thumb_output_dir: thumbOutputDir,
                        transcode_options: {
                            burnin: job.options?.burnin ?? appSettings.mp4.burnin,
                            metadata: job.options?.metadata ?? {
                                shot: shotCodeLabel,
                                version: job.meta?.versionName || "v001",
                                artist: profile?.full_name || "CTrack User"
                            },
                            codec: appSettings.mp4.codec,
                            crf: appSettings.mp4.crf,
                            preset: appSettings.mp4.preset,
                            max_width: appSettings.mp4.maxWidth || undefined,
                            max_height: appSettings.mp4.maxHeight || undefined,
                            pixel_format: appSettings.mp4.pixelFormat,
                            frame_start: resolvedFrameStart ?? undefined,
                            frame_end: resolvedFrameEnd ?? undefined,
                            fps: appSettings.gif.fps || 24
                        },
                        webp_options: {
                            width: appSettings.gif.width || 480,
                            fps: appSettings.gif.fps || 8,
                            duration_seconds: appSettings.gif.durationSeconds || 3,
                            frame_skip: appSettings.gif.frameSkip || 2,
                            quality: 75
                        },
                        thumb_options: {}
                    }
                });
                transcodeResult = pythonResult.transcode;
                webpResult = pythonResult.webp;
                thumbnailsResult = pythonResult.thumbnails ?? null;
                if (pythonResult.thumbnails?.thumbnail) cleanupFiles.push(pythonResult.thumbnails.thumbnail);
                if (pythonResult.thumbnails?.webp) cleanupFiles.push(pythonResult.thumbnails.webp);
            } else {
                const transcodeInputPath = !isInputVideoFile && resolvedFrameStart != null && resolvedFrameEnd != null
                    ? job.filePath.replace(/(\d+)(\.\w+)$/, '%04d$2')
                    : job.filePath;
                transcodeResult = await (window as any).ipcRenderer.invoke('python-command', {
                    command: 'transcode',
                    params: {
                        input_path: transcodeInputPath,
                        output_path: mp4Path,
                        options: {
                            burnin: job.options?.burnin ?? appSettings.mp4.burnin,
                            metadata: job.options?.metadata ?? {
                                shot: shotCodeLabel,
                                version: job.meta?.versionName || "v001",
                                artist: profile?.full_name || "CTrack User"
                            },
                            codec: appSettings.mp4.codec,
                            crf: appSettings.mp4.crf,
                            preset: appSettings.mp4.preset,
                            max_width: appSettings.mp4.maxWidth || undefined,
                            max_height: appSettings.mp4.maxHeight || undefined,
                            pixel_format: appSettings.mp4.pixelFormat,
                            frame_start: resolvedFrameStart ?? undefined,
                            frame_end: resolvedFrameEnd ?? undefined
                        }
                    }
                });
            }

            if (transcodeResult.status === 'error') throw new Error((transcodeResult as { message?: string }).message);
            addLog('info', `[GENERATE] MP4 Done: ${transcodeResult.output}`);
            addJobLog(jobId, "MP4 transcoding complete.", {
                runId,
                component: 'python',
                stage: 'transcode',
                eventType: 'completed',
                payload: { output: transcodeResult.output ?? null }
            });
            if (webpResult?.status === 'success') {
                addLog('info', `[GENERATE] WebP Done: ${webpResult.output}`);
                addJobLog(jobId, "WebP generation complete.", {
                    runId,
                    component: 'python',
                    stage: 'transcode',
                    eventType: 'completed',
                    payload: { output: webpResult.output ?? null, type: 'webp' }
                });
            }

            updateJob(jobId, { status: 'uploading', progress: 50 });
            addJobLog(jobId, "Uploading files to S3...", {
                runId,
                component: 's3',
                stage: 'upload',
                eventType: 'started'
            });

            const { data: latestVersions } = await supabase
                .from('shot_versions')
                .select('version_number')
                .eq('shot_id', sId)
                .order('version_number', { ascending: false })
                .limit(1);

            const nextVersion = (latestVersions?.[0]?.version_number ?? 0) + 1;
            const versionLabel = `v${String(nextVersion).padStart(3, '0')}`;

            const episodeCodeFromJob = resolvedEpisodeCode;
            const storagePlan = job.meta?.storagePlan;
            const shotRootPath = storagePlan?.shotRootPath || buildShotRootPath(projectCode as string, sequenceName as string, shotCode as string, episodeCodeFromJob);
            const versionsBasePath = storagePlan?.versionsBasePath || `${shotRootPath}/Versions`;
            const rawTrackingNumber = job.meta?.trackingNumber || job.context?.trackingNumber || null;
            const sanitizedTrackingNumber = sanitizeTrackingNumber(rawTrackingNumber);
            const versionFolderName = sanitizedTrackingNumber || versionLabel;

            // Preserve the original file name, changing extension to .mp4
            const originalFileName = job.filePath.split(/[\\/]/).pop() ?? job.filePath;
            // IMPORTANT: frameStart/frameEnd may come from mp4box on videos; that must NOT make us treat it as an image sequence.
            const isImageSeq = !isInputVideoFile && resolvedFrameStart != null && resolvedFrameEnd != null;
            const baseFileName = isImageSeq ? originalFileName.replace(/\.(\d+)(\.\w+)$/, '') : originalFileName.replace(/\.[^/.]+$/, '');
            const versionFileName = `${baseFileName}.mp4`;
            // ShotGrid-style path:
            // Projects/{project}/{episode}/{sequence}/{shot}/Versions/{trackingOrVersion}/
            const versionPath = joinPathSegment(versionsBasePath, versionFolderName);
            const s3Key = joinPathSegment(versionPath, versionFileName);
            addJobLog(jobId, `Resolved version path: ${versionPath}`, {
                runId,
                component: 'queue',
                stage: 'path',
                eventType: 'log'
            });
            const versionReportEntries: UploadReportEntry[] = [];
            let versionReportTotal = 0;

            const fileNameBase = baseFileName;
            const thumbFilePath = thumbnailsResult?.thumbnail;
            const thumbS3Key = thumbFilePath
                ? `${versionPath}/thumbnails/${fileNameBase}_thumb.jpg`
                : null;
            const webpS3Key = webpResult?.status === 'success'
                ? `${versionPath}/thumbnails/${fileNameBase}_preview.webp`
                : null;

            addLog('info', `[UPLOAD] Starting MP4 + thumb + WebP in parallel: ${transcodeResult.output}`);
            const [uploadResult, thumbUpload, webpUpload] = await Promise.all([
                (window as any).ipcRenderer.invoke('upload-s3', {
                    filePath: transcodeResult.output,
                    bucketName: "ctrack-storage",
                    key: s3Key
                }),
                thumbS3Key && thumbFilePath
                    ? (window as any).ipcRenderer.invoke('upload-s3', {
                        filePath: thumbFilePath,
                        bucketName: "ctrack-storage",
                        key: thumbS3Key
                    })
                    : Promise.resolve(null),
                webpResult?.status === 'success' && webpS3Key
                    ? (window as any).ipcRenderer.invoke('upload-s3', {
                        filePath: webpResult.output,
                        bucketName: "ctrack-storage",
                        key: webpS3Key
                    })
                    : Promise.resolve(null)
            ]);

            if (uploadResult.status === 'error') throw new Error(uploadResult.message);
            const mp4Size = (uploadResult as { size?: number })?.size ?? 0;
            versionReportEntries.push({ name: versionFileName, s3Key: s3Key, size: mp4Size, status: 'ok' });
            versionReportTotal += mp4Size;
            addLog('info', `[UPLOAD] MP4 Success.`);
            addJobLog(jobId, "MP4 upload successful.", {
                runId,
                component: 's3',
                stage: 'upload',
                eventType: 'completed',
                payload: { key: s3Key, size: mp4Size }
            });

            if (thumbUpload && thumbS3Key) {
                if (thumbUpload.status !== 'error') {
                    const thumbSize = (thumbUpload as { size?: number })?.size ?? 0;
                    versionReportEntries.push({ name: `${fileNameBase}_thumb.jpg`, s3Key: thumbS3Key, size: thumbSize, status: 'ok' });
                    versionReportTotal += thumbSize;
                    addLog('info', `[UPLOAD] Thumbnail JPG Success.`);
                }
            }

            // Store S3 keys: thumbnail_url = static JPG (for default view), webp used for hover via type=preview
            const mediaStoragePath = s3Key;
            const thumbJpgPath = thumbUpload && thumbS3Key && thumbUpload.status !== 'error' ? thumbS3Key : null;

            let thumbnailStoragePath: string | null = thumbJpgPath;
            if (webpUpload && webpS3Key) {
                if (webpUpload.status !== 'error') {
                    if (!thumbnailStoragePath) thumbnailStoragePath = webpS3Key;
                    const webpSize = (webpUpload as { size?: number })?.size ?? 0;
                    versionReportEntries.push({ name: `${fileNameBase}_preview.webp`, s3Key: webpS3Key, size: webpSize, status: 'ok' });
                    versionReportTotal += webpSize;
                    addLog('info', `[UPLOAD] WebP Success.`);
                    addJobLog(jobId, "WebP upload successful.", {
                        runId,
                        component: 's3',
                        stage: 'upload',
                        eventType: 'completed',
                        payload: { key: webpS3Key, size: webpSize }
                    });
                } else {
                    versionReportEntries.push({ name: `${fileNameBase}_preview.webp`, s3Key: webpS3Key, size: 0, status: 'error' });
                }
            }

            if (user?.id) {
                updateJob(jobId, { status: 'submitting', progress: 90 });
                addJobLog(jobId, "Submitting to database...", {
                    runId,
                    component: 'db',
                    stage: 'submit',
                    eventType: 'started'
                });

                const payload: any = {
                    shot_id: sId,
                    project_id: pId,
                    version_number: nextVersion,
                    version_name: job.meta?.versionName || versionLabel,
                    file_name: versionFileName,
                    tracking_number: sanitizedTrackingNumber,
                    task_id: job.context?.taskId || null,
                    file_url: mediaStoragePath,
                    video_path: mediaStoragePath,
                    thumbnail_url: thumbnailStoragePath,
                    exr_path: job.filePath,
                    frame_start: resolvedFrameStart ?? null,
                    frame_end: resolvedFrameEnd ?? null,
                    status: 'Pending Review',
                    submitted_by: user.id,
                    submitted_at: new Date().toISOString(),
                    file_size_bytes: uploadResult.size || 0,
                    publisher_name: profile?.full_name || user?.email || "Unknown",
                    published_date: new Date().toISOString(),
                    review_notes: job.meta?.submissionNotes || null,
                };

                const originalSize = (job as any).size || 0;
                const isSourceVideoFile = isInputVideoFile;

                if (!isSourceVideoFile && originalSize > 0) {
                    payload.exr_total_size_bytes = originalSize;
                }

                addLog('info', `[DATABASE] Inserting version ${versionLabel} for shot ${shotCodeLabel}`);

                const { data: insertedVersion, error: dbError } = await supabase
                    .from('shot_versions')
                    .insert(payload)
                    .select('id')
                    .single();

                if (dbError) {
                    console.error("Supabase Error:", dbError);
                    throw new Error(`Database error: ${dbError.message || JSON.stringify(dbError)}`);
                }
                addLog('info', `[DATABASE] Success.`);

                // Optionally fill shot frame range from version when shot has none (free data)
                if (resolvedFrameStart != null && resolvedFrameEnd != null) {
                    const { data: shotRow } = await supabase.from('shots').select('start_frame, end_frame').eq('id', sId).single();
                    if (shotRow && shotRow.start_frame == null && shotRow.end_frame == null) {
                        const durationFrames = resolvedFrameEnd - resolvedFrameStart + 1;
                        await supabase.from('shots').update({ start_frame: resolvedFrameStart, end_frame: resolvedFrameEnd, duration_frames: durationFrames }).eq('id', sId);
                        addJobLog(jobId, `Updated shot frame range: ${resolvedFrameStart}–${resolvedFrameEnd}`, { runId, component: 'db', stage: 'submit', eventType: 'log' });
                    }
                }

                // Notify project supervisors/managers and shot artist
                try {
                    const versionId = insertedVersion?.id;
                    await notifyShotPublishRecipients({
                        actorId: user.id,
                        projectId: pId,
                        shotId: sId,
                        taskId: job.context?.taskId ?? null,
                        versionId: versionId ?? null,
                        type: 'version_submitted',
                        granularType: 'my_version_created',
                        title: 'Version submitted',
                        message: `${profile?.full_name || user?.email || 'Someone'} submitted ${versionLabel} for ${shotCodeLabel}`,
                        explicitRecipientIds: job.meta?.notifyUserIds ?? []
                    });
                    addJobLog(jobId, "Notification dispatched for version publish.", {
                        runId,
                        component: 'db',
                        stage: 'notify',
                        eventType: 'completed'
                    });
                } catch (notifyErr) {
                    const nMsg = notifyErr instanceof Error ? notifyErr.message : String(notifyErr);
                    const nCode = notifyErr && typeof notifyErr === 'object' && 'code' in notifyErr ? (notifyErr as { code: string }).code : '';
                    console.warn('[NOTIFY] version_submitted failed:', notifyErr);
                    addJobLog(jobId, `Notification failed: ${nCode ? `[${nCode}] ` : ''}${nMsg}`, {
                        runId,
                        component: 'db',
                        stage: 'notify',
                        eventType: 'failed',
                        level: 'warn'
                    });
                }
                addJobLog(jobId, "Database entry created successfully.", {
                    runId,
                    component: 'db',
                    stage: 'submit',
                    eventType: 'completed'
                });
            }

            logPublishReport(addLog, fileName, versionLabel, versionReportEntries, versionReportTotal);
            updateJob(jobId, { status: 'completed', progress: 100 });
            addJobLog(jobId, "Publish process finished successfully.", {
                runId,
                component: 'queue',
                stage: 'finalize',
                eventType: 'completed'
            });
            (window as any).ipcRenderer.invoke('notify', {
                title: 'Publish Complete',
                body: `Successfully published ${fileName}`
            });
            addJobLog(jobId, "Cleanup complete.", {
                runId,
                component: 'queue',
                stage: 'cleanup',
                eventType: 'completed'
            });
            updateJob(jobId, { status: 'completed', progress: 100 });
            addLog('info', `[DONE] ${fileName} published successfully!`);

        } catch (error) {
            const message = error instanceof Error ? error.message : (typeof error === 'object' ? JSON.stringify(error) : String(error));
            updateJob(jobId, { status: 'error', error: message });
            addLog('error', `Publish failed: ${fileName} — ${message}`);
            addJobLog(jobId, `ERROR: ${message}`, {
                runId,
                level: 'error',
                component: 'queue',
                stage: 'failed',
                eventType: 'failed'
            });
            (window as any).ipcRenderer.invoke('notify', {
                title: 'Publish Failed',
                body: `Error: ${message}`
            });
        } finally {
            // Cleanup temp files
            for (const file of cleanupFiles) {
                try {
                    addLog('info', `[CLEANUP] Removing temp file: ${file}`);
                    await (window as any).ipcRenderer.invoke('fs:delete-file', file);
                } catch (e) {
                    console.error("Failed to cleanup", file, e);
                }
            }
            delete activeJobRunRef.current[jobId];
            delete uploadProgressRef.current[jobId];
            processNextJobRef.current?.();
        }
    }, [queue, updateJob, addLog, user?.id, addJobLog]);

    const startPublishElement = useCallback(async (jobId: string, options?: { elementNotes?: string }) => {
        const job = queue.find(j => j.id === jobId);
        if (!job || !job.context?.shotId || !job.context?.projectId || !user?.id) return;
        const pId = job.context.projectId as string;
        const sId = job.context.shotId as string;
        let projectCode = job.context?.projectCode ?? null;
        let sequenceName = job.context?.sequenceName ?? null;
        let shotCode = job.context?.shotCode ?? null;
        let episodeCodeFromJob = job.context?.episodeCode ?? null;
        const hasStoragePlanRoot = Boolean(job.meta?.storagePlan?.shotRootPath);
        if (!hasStoragePlanRoot) {
            const canonical = await resolveCanonicalPathContext({
                projectId: pId,
                shotId: sId,
                projectCode,
                sequenceName,
                shotCode,
                episodeCode: episodeCodeFromJob
            });
            projectCode = canonical.projectCode;
            sequenceName = canonical.sequenceName;
            shotCode = canonical.shotCode;
            episodeCodeFromJob = canonical.episodeCode;
        }
        if (!hasStoragePlanRoot && (!projectCode || !sequenceName || !shotCode)) {
            updateJob(jobId, {
                status: 'error',
                error: 'Missing project/sequence/shot context for canonical storage path'
            });
            addJobLog(jobId, 'ERROR: Missing canonical path context (projectCode, sequenceName, shotCode)', {
                component: 'queue',
                stage: 'path',
                eventType: 'failed',
                level: 'error'
            });
            setTimeout(() => processNextJobRef.current?.(), 0);
            return;
        }

        const fileName = job.filePath.split(/[\\/]/).pop() ?? job.filePath;
        const meta = job.meta;
        let resolvedFrameStart = meta?.frameStart ?? meta?.storagePlan?.sourceFrameRange?.start;
        let resolvedFrameEnd = meta?.frameEnd ?? meta?.storagePlan?.sourceFrameRange?.end;
        const isInputVideoFile = /\.(mp4|mov|avi|mkv|mxf)$/i.test(job.filePath);

        // If single video file and no frame range, read metadata from file (ProRes/H.264/H.265)
        const isSingleVideoForMeta = isInputVideoFile && resolvedFrameStart == null && resolvedFrameEnd == null;
        if (isSingleVideoForMeta) {
            try {
                const videoMeta = await (window as any).ipcRenderer.invoke('video-metadata', job.filePath);
                if (videoMeta?.frameStart != null && videoMeta?.frameEnd != null) {
                    resolvedFrameStart = videoMeta.frameStart;
                    resolvedFrameEnd = videoMeta.frameEnd;
                }
            } catch (_) { /* non-fatal */ }
        }

        // IMPORTANT: frameStart/frameEnd may come from mp4box on videos; that must NOT make us treat it as an image sequence.
        const isImageSequence = !isInputVideoFile && resolvedFrameStart != null && resolvedFrameEnd != null;
        const elementBaseName = isImageSequence ? fileName.replace(/\.(\d+)(\.\w+)$/, '') : fileName.replace(/\.[^/.]+$/, '');
        const elementNotesVal = options?.elementNotes?.trim() ?? meta?.elementNotes?.trim() ?? null;
        const categoryVal = meta?.elementCategory || elementCategory || 'media';
        const elementTypeVal = meta?.elementType || elementType || 'plate';

        addLog('info', `[CONTEXT] Shot: ${shotCode ?? 'UNKNOWN'} (${sId}) | Project: ${projectCode ?? 'UNKNOWN'} (${pId})`);
        addLog('info', `[START] Publishing element: ${fileName} (${categoryVal}/${elementTypeVal})`);
        const runId = `${jobId}-${Date.now()}`;
        activeJobRunRef.current[jobId] = runId;
        uploadProgressRef.current[jobId] = 0;
        addJobLog(jobId, `Starting element publish for ${fileName}`, {
            runId,
            component: 'renderer',
            stage: 'queue',
            eventType: 'started'
        });
        setActiveJobId(jobId);

        // Track temporary files for cleanup
        const cleanupFiles: string[] = [];

        updateJob(jobId, { status: 'transcoding', progress: 10 });

        try {
            const appSettings: AppSettings = await (window as any).ipcRenderer.invoke('settings:read').then((s: Partial<AppSettings> | null) => ({
                ...DEFAULT_SETTINGS,
                ...s
            }));

            // Get temp directory for thumbnails/proxies
            const tempDir = await (window as any).ipcRenderer.invoke('app:get-temp-path');
            // Use job ID to create unique subfolder for this job's temp files
            const uniqueTempDir = `${tempDir}\\ctrack_publish_${job.id}`;
            await (window as any).ipcRenderer.invoke('app:ensure-dir', uniqueTempDir);

            // 1. Generate Thumbnails (and transcode in parallel for video/sequence)
            updateJob(jobId, { status: 'transcoding', progress: 20 });
            addJobLog(jobId, "Generating thumbnails/proxy media...", {
                runId,
                component: 'python',
                stage: 'transcode',
                eventType: 'started'
            });
            const thumbDir = uniqueTempDir;
            const isVideoFile = /\.(mp4|mov|avi|mkv)$/.test(job.filePath.toLowerCase());
            let thumbResult: { status: string; thumbnail?: string; webp?: string };
            let transcodeResultForElement: { status: string; output?: string } | null = null;

            if (isVideoFile || isImageSequence) {
                const tempMp4Path = `${uniqueTempDir}\\${elementBaseName}.mp4`;
                const tempWebpPath = `${thumbDir}\\preview.webp`;
                cleanupFiles.push(tempMp4Path);
                addLog('info', `[GENERATE] MP4 first (chunked if long sequence), then WebP + thumbnails from MP4: ${thumbDir}`);
                const transcodeInputPath = isImageSequence ? job.filePath.replace(/(\d+)(\.\w+)$/, '%04d$2') : job.filePath;
                const pythonResult = await (window as any).ipcRenderer.invoke('python-command', {
                    command: 'transcode_then_webp_thumb',
                    params: {
                        input_path: transcodeInputPath,
                        mp4_path: tempMp4Path,
                        webp_path: tempWebpPath,
                        thumb_output_dir: thumbDir,
                        transcode_options: {
                            burnin: false,
                            start_frame: resolvedFrameStart ?? 1001,
                            frame_start: resolvedFrameStart ?? 1001,
                            frame_end: resolvedFrameEnd ?? undefined,
                            fps: 24,
                            codec: appSettings.mp4.codec,
                            crf: appSettings.mp4.crf,
                            preset: appSettings.mp4.preset,
                            max_width: appSettings.mp4.maxWidth || undefined,
                            max_height: appSettings.mp4.maxHeight || undefined,
                            pixel_format: appSettings.mp4.pixelFormat
                        },
                        webp_options: {
                            width: appSettings.gif.width || 480,
                            fps: appSettings.gif.fps || 6,
                            frame_skip: appSettings.gif.frameSkip || 2
                        },
                        thumb_options: {
                            frame_skip: appSettings.gif.frameSkip || 2,
                            fps: appSettings.gif.fps || 6,
                            frame_start: resolvedFrameStart ?? null,
                            frame_end: resolvedFrameEnd ?? null
                        }
                    }
                });
                if (pythonResult.status === 'error') throw new Error((pythonResult as { message?: string }).message);
                thumbResult = pythonResult.thumbnails;
                transcodeResultForElement = pythonResult.transcode;
            } else {
                addJobLog(jobId, "Generating thumbnails...");
                thumbResult = await (window as any).ipcRenderer.invoke('python-command', {
                    command: 'thumbnails',
                    params: {
                        input_path: job.filePath,
                        output_dir: thumbDir,
                        options: {
                            frame_skip: appSettings.gif.frameSkip || 2,
                            fps: appSettings.gif.fps || 6,
                            frame_start: resolvedFrameStart ?? null,
                            frame_end: resolvedFrameEnd ?? null
                        }
                    }
                });
            }
            if (thumbResult.status === 'success') {
                addLog('info', `[GENERATE] Thumbnails Done.`);
                addJobLog(jobId, "Thumbnail generation complete.", {
                    runId,
                    component: 'python',
                    stage: 'transcode',
                    eventType: 'completed',
                    payload: {
                        thumbnail: thumbResult.thumbnail ?? null,
                        webp: thumbResult.webp ?? null
                    }
                });
                if (thumbResult.thumbnail) cleanupFiles.push(thumbResult.thumbnail);
                if (thumbResult.webp) cleanupFiles.push(thumbResult.webp);
            }

            let thumbnailS3Url: string | null = null;
            let finalS3Key: string = "";
            let thumbS3Key: string | null = null;
            let webpS3Key: string | null = null;

            const isPlate = elementTypeVal === 'plate';
            let nextVersion: number;
            if (isPlate) {
                nextVersion = 0;
            } else {
                const { data: latestElements } = await supabase
                    .from('shot_elements')
                    .select('version_number')
                    .eq('shot_id', sId)
                    .order('version_number', { ascending: false })
                    .limit(1);
                nextVersion = (latestElements?.[0]?.version_number ?? 0) + 1;
            }
            const versionLabel = `v${String(nextVersion).padStart(3, '0')}`;

            const storagePlan = job.meta?.storagePlan;
            const shotRootPath = storagePlan?.shotRootPath || buildShotRootPath(projectCode as string, sequenceName as string, shotCode as string, episodeCodeFromJob);
            const elementsBasePath = storagePlan?.elementsBasePath || `${shotRootPath}/Elements`;
            // ShotGrid-style element path:
            // Projects/{project}/{episode}/{sequence}/{shot}/Elements/{vLabel}/
            const versionPath = joinPathSegment(elementsBasePath, versionLabel);
            addJobLog(jobId, `Resolved element path: ${versionPath}`, {
                runId,
                component: 'queue',
                stage: 'path',
                eventType: 'log'
            });
            const reportEntries: UploadReportEntry[] = [];
            let reportTotalBytes = 0;

            updateJob(jobId, { status: 'uploading', progress: 40 });
            addJobLog(jobId, "Uploading media file...", {
                runId,
                component: 's3',
                stage: 'upload',
                eventType: 'started'
            });

            const thumbS3KeyTarget = thumbResult.status === 'success' ? joinPathSegment(`${versionPath}/thumbnails`, `${elementBaseName}_thumb.jpg`) : null;
            const webpS3KeyTarget = thumbResult.webp ? joinPathSegment(`${versionPath}/thumbnails`, `${elementBaseName}_preview.webp`) : null;
            const mediaFileToUpload = transcodeResultForElement?.status === 'success'
                ? transcodeResultForElement.output
                : (!isVideoFile && !isImageSequence ? job.filePath : null);
            const mediaS3Key = mediaFileToUpload
                ? (transcodeResultForElement ? joinPathSegment(versionPath, `${elementBaseName}.mp4`) : joinPathSegment(versionPath, fileName))
                : null;

            addLog('info', `[UPLOAD] Starting thumb + webp + media in parallel`);
            const [thumbUpload, webpUpload, mediaUpload] = await Promise.all([
                thumbS3KeyTarget && thumbResult.thumbnail
                    ? (window as any).ipcRenderer.invoke('upload-s3', { filePath: thumbResult.thumbnail, bucketName: "ctrack-storage", key: thumbS3KeyTarget })
                    : Promise.resolve(null),
                webpS3KeyTarget && thumbResult.webp
                    ? (window as any).ipcRenderer.invoke('upload-s3', { filePath: thumbResult.webp, bucketName: "ctrack-storage", key: webpS3KeyTarget })
                    : Promise.resolve(null),
                mediaFileToUpload && mediaS3Key
                    ? (window as any).ipcRenderer.invoke('upload-s3', { filePath: mediaFileToUpload, bucketName: "ctrack-storage", key: mediaS3Key })
                    : Promise.resolve(null)
            ]);

            if (thumbUpload && thumbS3KeyTarget) {
                if (thumbUpload.status !== 'error') {
                    thumbS3Key = thumbUpload.key;
                    thumbnailS3Url = (thumbUpload as { url?: string }).url ?? null;
                    const thumbSize = (thumbUpload as { size?: number }).size ?? 0;
                    reportEntries.push({ name: 'thumbnail', s3Key: thumbS3KeyTarget, size: thumbSize, status: 'ok' });
                    reportTotalBytes += thumbSize;
                    addLog('info', `[UPLOAD] Thumbnail Success`);
                } else if (thumbResult.status === 'success') {
                    reportEntries.push({ name: 'thumbnail', s3Key: thumbS3KeyTarget, size: 0, status: 'error' });
                }
            }
            if (webpUpload && webpS3KeyTarget) {
                if (webpUpload.status !== 'error') {
                    webpS3Key = webpUpload.key;
                    const webpSize = (webpUpload as { size?: number }).size ?? 0;
                    reportEntries.push({ name: 'preview.webp', s3Key: webpS3KeyTarget, size: webpSize, status: 'ok' });
                    reportTotalBytes += webpSize;
                    addLog('info', `[UPLOAD] WebP Success`);
                } else {
                    reportEntries.push({ name: 'preview.webp', s3Key: webpS3KeyTarget, size: 0, status: 'error' });
                }
            }

            let mediaUrl = '';
            let finalUploadResult: any = null;
            if (mediaUpload && mediaS3Key) {
                if (mediaUpload.status === 'error') throw new Error(mediaUpload.message);
                finalS3Key = mediaS3Key;
                finalUploadResult = mediaUpload;
                mediaUrl = (mediaUpload as { url?: string }).url ?? '';
                addJobLog(jobId, "Media upload successful.", {
                    runId,
                    component: 's3',
                    stage: 'upload',
                    eventType: 'completed',
                    payload: { key: mediaS3Key, size: (mediaUpload as { size?: number }).size ?? 0 }
                });
            }
            const mediaSize = (finalUploadResult as { size?: number })?.size ?? 0;
            const mediaDisplayName = transcodeResultForElement ? `${elementBaseName}.mp4` : fileName;
            reportEntries.push({ name: mediaDisplayName, s3Key: finalS3Key, size: mediaSize, status: 'ok' });
            reportTotalBytes += mediaSize;

            // Record original source size if it's a sequence/plate
            const originalSize = (job as any).size || 0;

            addJobLog(jobId, "Submitting to database...", {
                runId,
                component: 'db',
                stage: 'submit',
                eventType: 'started'
            });
            const { error: dbError } = await supabase.from('shot_elements').insert({
                shot_id: sId,
                project_id: pId,
                category: categoryVal,
                element_type: elementTypeVal,
                name: isImageSequence ? elementBaseName : fileName,
                description: elementNotesVal,
                url: mediaUrl,
                thumbnail_url: thumbnailS3Url,
                version_number: nextVersion,
                storage_path: finalS3Key,
                exr_path: job.filePath,
                frame_start: resolvedFrameStart ?? null,
                frame_end: resolvedFrameEnd ?? null,
                file_size_bytes: (originalSize > 0 ? originalSize : finalUploadResult?.size) || 0,
                metadata: {
                    s3_thumbnail_key: thumbS3Key,
                    s3_webp_key: webpS3Key,
                    original_name: isImageSequence ? elementBaseName : fileName,
                    ...(originalSize > 0 && { sequence_total_bytes: originalSize })
                },
                created_by: user.id
            });

            if (dbError) {
                console.error("Supabase Error (Element):", dbError);
                throw new Error(`Database error: ${dbError.message || JSON.stringify(dbError)}`);
            }
            // Optionally fill shot frame range from element when shot has none
            if (resolvedFrameStart != null && resolvedFrameEnd != null) {
                const { data: shotRow } = await supabase.from('shots').select('start_frame, end_frame').eq('id', sId).single();
                if (shotRow && shotRow.start_frame == null && shotRow.end_frame == null) {
                    const durationFrames = resolvedFrameEnd - resolvedFrameStart + 1;
                    await supabase.from('shots').update({ start_frame: resolvedFrameStart, end_frame: resolvedFrameEnd, duration_frames: durationFrames }).eq('id', sId);
                    addJobLog(jobId, `Updated shot frame range: ${resolvedFrameStart}–${resolvedFrameEnd}`, { runId, component: 'db', stage: 'submit', eventType: 'log' });
                }
            }
            try {
                await notifyShotPublishRecipients({
                    actorId: user.id,
                    projectId: pId,
                    shotId: sId,
                    taskId: job.context?.taskId ?? null,
                    versionId: null,
                    type: 'element_published',
                    granularType: 'my_element_published',
                    title: 'Element published',
                    message: `${profile?.full_name || user?.email || 'Someone'} published element ${isImageSequence ? elementBaseName : fileName} for ${shotCode ?? 'SHOT'}`,
                    explicitRecipientIds: job.meta?.notifyUserIds ?? []
                });
                addJobLog(jobId, "Notification dispatched for element publish.", {
                    runId,
                    component: 'db',
                    stage: 'notify',
                    eventType: 'completed'
                });
            } catch (notifyErr) {
                const nMsg = notifyErr instanceof Error ? notifyErr.message : String(notifyErr);
                const nCode = notifyErr && typeof notifyErr === 'object' && 'code' in notifyErr ? (notifyErr as { code: string }).code : '';
                console.warn('[NOTIFY] element_published failed:', notifyErr);
                addJobLog(jobId, `Notification failed: ${nCode ? `[${nCode}] ` : ''}${nMsg}`, {
                    runId,
                    component: 'db',
                    stage: 'notify',
                    eventType: 'failed',
                    level: 'warn'
                });
            }
            const reportDisplayName = isImageSequence ? elementBaseName : fileName;
            logPublishReport(addLog, reportDisplayName, `v${String(nextVersion).padStart(3, '0')}`, reportEntries, reportTotalBytes);
            updateJob(jobId, { status: 'completed', progress: 100 });
            addLog('info', `Element published: ${reportDisplayName} (v${String(nextVersion).padStart(3, '0')})`);
            addJobLog(jobId, "Element publish complete.", {
                runId,
                component: 'queue',
                stage: 'finalize',
                eventType: 'completed'
            });
            (window as any).ipcRenderer.invoke('notify', { title: 'Element published', body: `${reportDisplayName} v${String(nextVersion).padStart(3, '0')}` });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            updateJob(jobId, { status: 'error', error: message });
            addLog('error', `Element publish failed: ${fileName} — ${message}`);
            addJobLog(jobId, `ERROR: ${message}`, {
                runId,
                level: 'error',
                component: 'queue',
                stage: 'failed',
                eventType: 'failed'
            });
            (window as any).ipcRenderer.invoke('notify', { title: 'Publish failed', body: message });
        } finally {
            setActiveJobId(null);
            // Cleanup temp files
            for (const file of cleanupFiles) {
                try {
                    addLog('info', `[CLEANUP] Removing temp file: ${file}`);
                    await (window as any).ipcRenderer.invoke('fs:delete-file', file);
                } catch (e) {
                    console.error("Failed to cleanup", file, e);
                }
            }
            delete activeJobRunRef.current[jobId];
            delete uploadProgressRef.current[jobId];
            processNextJobRef.current?.();
        }
    }, [queue, updateJob, elementCategory, elementType, user?.id, addLog, addJobLog]);

    const processNextJob = useCallback(async () => {
        const jobs = await (window as any).ipcRenderer.invoke('queue:get-jobs');
        const idleList = (jobs || []).filter((j: any) => j.status === 'idle');
        const next = idleList[idleList.length - 1];
        if (!next) {
            setActiveJobId(null);
            return;
        }
        let meta: PublishJobMeta = { tab: 'version' };
        try {
            if (next.meta && typeof next.meta === 'string') meta = JSON.parse(next.meta) as PublishJobMeta;
        } catch (_) { }
        const isElement = meta.tab === 'element';
        try {
            if (isElement) {
                await startPublishElement(next.id, { elementNotes: meta.elementNotes });
            } else {
                await startPublish(next.id);
            }
        } catch (_) {
        } finally {
            setActiveJobId(null);
        }
    }, [startPublish, startPublishElement]);

    processNextJobRef.current = processNextJob;

    const removeJob = useCallback((id: string) => {
        setQueue(prev => prev.filter(job => job.id !== id));
        (window as any).ipcRenderer.invoke('queue:remove-job', id);
    }, []);

    const clearQueue = useCallback(async () => {
        setQueue(prev => prev.filter(j => j.status !== 'completed'));
        await (window as any).ipcRenderer.invoke('queue:clear');
    }, []);

    const purgeQueue = useCallback(async () => {
        setQueue([]);
        await (window as any).ipcRenderer.invoke('queue:purge');
    }, []);

    const addJobs = useCallback((paths: string[], options?: PublishJob['options'], meta?: PublishJobMeta, autoStart: boolean = false) => {
        paths.map(p => addJob(p, options, meta));
        if (autoStart) {
            setTimeout(() => processNextJob(), 100);
        }
    }, [addJob, processNextJob]);

    return { queue, addJob, addJobs, startPublish, startPublishElement, processNextJob, removeJob, clearQueue, purgeQueue, getJobLogs, getJobEvents };
}
