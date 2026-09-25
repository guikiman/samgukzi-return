import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAuthError, type AuthError, type AuthUser } from '../auth/contracts.js';

export interface CloudSave {
    readonly id: string;
    readonly userId: string;
    readonly slotId: string;
    readonly name?: string;
    readonly description?: string;
    readonly data: string;
    readonly checksum?: string;
    readonly version: number;
    readonly sizeBytes?: number;
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly createdAt?: string;
    readonly updatedAt?: string;
}

export interface CloudSaveInput {
    readonly slotId: string;
    readonly data: string;
    readonly name?: string;
    readonly description?: string;
    readonly checksum?: string;
    readonly version?: number;
    readonly metadata?: Readonly<Record<string, unknown>>;
}

export type CloudSaveResult<T> =
    | { readonly data: T; readonly error: null }
    | { readonly data: null; readonly error: AuthError };

export interface CloudSaveRepository {
    list(userId: string): Promise<CloudSaveResult<readonly CloudSave[]>>;
    get(userId: string, slotId: string): Promise<CloudSaveResult<CloudSave | null>>;
    save(userId: string, input: CloudSaveInput): Promise<CloudSaveResult<CloudSave>>;
    remove(userId: string, slotId: string): Promise<CloudSaveResult<null>>;
}

interface CloudSaveRow {
    readonly id: string;
    readonly user_id: string;
    readonly slot_id: string;
    readonly name: string | null;
    readonly description: string | null;
    readonly data: string;
    readonly checksum: string | null;
    readonly version: number;
    readonly size_bytes: number | null;
    readonly metadata: Record<string, unknown> | null;
    readonly created_at: string | null;
    readonly updated_at: string | null;
}

function mapRow(row: CloudSaveRow): CloudSave {
    return {
        id: row.id,
        userId: row.user_id,
        slotId: row.slot_id,
        ...(row.name === null ? {} : { name: row.name }),
        ...(row.description === null ? {} : { description: row.description }),
        data: row.data,
        ...(row.checksum === null ? {} : { checksum: row.checksum }),
        version: row.version,
        ...(row.size_bytes === null ? {} : { sizeBytes: row.size_bytes }),
        ...(row.metadata === null ? {} : { metadata: row.metadata }),
        ...(row.created_at === null ? {} : { createdAt: row.created_at }),
        ...(row.updated_at === null ? {} : { updatedAt: row.updated_at }),
    };
}

export class SupabaseCloudSaveRepository implements CloudSaveRepository {
    public constructor(private readonly client: SupabaseClient) {}

    public async list(userId: string): Promise<CloudSaveResult<readonly CloudSave[]>> {
        if (!userId) return this.unauthenticated();
        const { data, error } = await this.client
            .from('cloud_saves')
            .select('id,user_id,slot_id,name,description,data,checksum,version,size_bytes,metadata,created_at,updated_at')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false });
        if (error !== null) return { data: null, error: normalizeAuthError(error) };
        return { data: (data as CloudSaveRow[]).map(mapRow), error: null };
    }

    public async get(userId: string, slotId: string): Promise<CloudSaveResult<CloudSave | null>> {
        if (!userId) return this.unauthenticated();
        const { data, error } = await this.client
            .from('cloud_saves')
            .select('id,user_id,slot_id,name,description,data,checksum,version,size_bytes,metadata,created_at,updated_at')
            .eq('user_id', userId)
            .eq('slot_id', slotId)
            .maybeSingle();
        if (error !== null) return { data: null, error: normalizeAuthError(error) };
        return { data: data === null ? null : mapRow(data as CloudSaveRow), error: null };
    }


    public async save(userId: string, input: CloudSaveInput): Promise<CloudSaveResult<CloudSave>> {
        if (!userId) return this.unauthenticated();
        const row = {
            user_id: userId,
            slot_id: input.slotId,
            data: input.data,
            version: input.version ?? 1,
            size_bytes: input.data.length,
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.description === undefined ? {} : { description: input.description }),
            ...(input.checksum === undefined ? {} : { checksum: input.checksum }),
            ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        };
        const { data, error } = await this.client
            .from('cloud_saves')
            .upsert(row, { onConflict: 'user_id,slot_id' })
            .select('id,user_id,slot_id,name,description,data,checksum,version,size_bytes,metadata,created_at,updated_at')
            .single();
        if (error !== null) return { data: null, error: normalizeAuthError(error) };
        return { data: mapRow(data as CloudSaveRow), error: null };
    }

    public async remove(userId: string, slotId: string): Promise<CloudSaveResult<null>> {
        if (!userId) return this.unauthenticated();
        const { error } = await this.client
            .from('cloud_saves')
            .delete()
            .eq('user_id', userId)
            .eq('slot_id', slotId);
        if (error !== null) return { data: null, error: normalizeAuthError(error) };
        return { data: null, error: null };
    }

    private unauthenticated(): CloudSaveResult<never> {
        return {
            data: null,
            error: {
                code: 'invalid_credentials',
                message: 'A signed-in user is required for cloud saves',
                retryable: false,
            },
        };
    }
}

export class CloudSaveRepositoryImpl extends SupabaseCloudSaveRepository {}

export function createCloudSaveRepository(client: SupabaseClient): CloudSaveRepository {
    return new SupabaseCloudSaveRepository(client);
}

export function userIdFrom(user: AuthUser | null | undefined): string {
    return user?.id ?? '';
}
