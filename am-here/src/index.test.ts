import { describe, it, expect, beforeEach } from 'vitest';
import worker from './index';

// Mock KV namespace
class MockKV {
    private store = new Map<string, string>();

    async get(key: string): Promise<string | null> {
        return this.store.get(key) || null;
    }

    async put(key: string, value: string): Promise<void> {
        this.store.set(key, value);
    }

    async delete(key: string): Promise<void> {
        this.store.delete(key);
    }

    async list(): Promise<{ keys: { name: string }[] }> {
        return {
            keys: Array.from(this.store.keys()).map(name => ({ name }))
        };
    }

    clear() {
        this.store.clear();
    }
}

const mockEnv = {
    CACHE: new MockKV()
};

const createRequest = (body: any, method = 'POST') => {
    return new Request('https://example.com', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
};

describe('am-here worker', () => {
    beforeEach(() => {
        mockEnv.CACHE.clear();
    });

    it('should record arrival', async () => {
        const request = createRequest({
            location: 'gym',
            datetime: '2024-01-15T10:00:00Z',
            arrived: true,
            person: 'taimoor'
        });

        const response = await worker.fetch(request, mockEnv as any);
        const result = await response.json() as any;

        expect(response.status).toBe(200);
        expect(result.message).toBe('taimoor arrived gym at 2024-01-15T10:00:00Z');

        const arrivalTime = await mockEnv.CACHE.get('taimoor-gym-arrive');
        expect(arrivalTime).toBe('2024-01-15T10:00:00Z');
    });

    it('should record departure and create history', async () => {
        // First, record arrival
        await mockEnv.CACHE.put('taimoor-gym-arrive', '2024-01-15T10:00:00Z');

        const request = createRequest({
            location: 'gym',
            datetime: '2024-01-15T12:00:00Z',
            arrived: false,
            person: 'taimoor'
        });

        const response = await worker.fetch(request, mockEnv as any);
        const result = await response.json() as any;

        expect(response.status).toBe(200);
        expect(result.message).toBe('taimoor left gym at 2024-01-15T12:00:00Z (arrived at 2024-01-15T10:00:00Z)');

        const history = await mockEnv.CACHE.get('taimoor-gym-history');
        expect(JSON.parse(history!)).toEqual([
            ['2024-01-15T10:00:00Z', '2024-01-15T12:00:00Z']
        ]);

        // Should delete the arrival time after creating history
        const arrivalTime = await mockEnv.CACHE.get('taimoor-gym-arrive');
        expect(arrivalTime).toBeNull();
    });

    it('should handle multiple visits', async () => {
        // Record first visit
        await mockEnv.CACHE.put('taimoor-gym-arrive', '2024-01-15T10:00:00Z');
        await mockEnv.CACHE.put('taimoor-gym-history', JSON.stringify([
            ['2024-01-14T09:00:00Z', '2024-01-14T11:00:00Z']
        ]));

        const request = createRequest({
            location: 'gym',
            datetime: '2024-01-15T12:00:00Z',
            arrived: false,
            person: 'taimoor'
        });

        await worker.fetch(request, mockEnv as any);

        const history = await mockEnv.CACHE.get('taimoor-gym-history');
        expect(JSON.parse(history!)).toEqual([
            ['2024-01-14T09:00:00Z', '2024-01-14T11:00:00Z'],
            ['2024-01-15T10:00:00Z', '2024-01-15T12:00:00Z']
        ]);

        // Should delete the arrival time after creating history
        const arrivalTime = await mockEnv.CACHE.get('taimoor-gym-arrive');
        expect(arrivalTime).toBeNull();
    });

    it('should handle departure without prior arrival', async () => {
        const request = createRequest({
            location: 'gym',
            datetime: '2024-01-15T12:00:00Z',
            arrived: false,
            person: 'taimoor'
        });

        const response = await worker.fetch(request, mockEnv as any);
        const result = await response.json() as any;

        expect(response.status).toBe(200);
        expect(result.message).toBe('taimoor left gym at 2024-01-15T12:00:00Z (has no arrival)');

        // Should not create any history since there was no arrival
        const history = await mockEnv.CACHE.get('taimoor-gym-history');
        expect(history).toBeNull();
    });

    it('should return all cache data on GET request', async () => {
        // Add some test data
        await mockEnv.CACHE.put('taimoor-gym-arrive', '2024-01-15T10:00:00Z');
        await mockEnv.CACHE.put('taimoor-gym-history', JSON.stringify([
            ['2024-01-14T09:00:00Z', '2024-01-14T11:00:00Z']
        ]));

        const request = new Request('https://example.com', {
            method: 'GET'
        });

        const response = await worker.fetch(request, mockEnv as any);
        const result = await response.json() as any;

        expect(response.status).toBe(200);
        expect(result).toEqual({
            'taimoor-gym-arrive': '2024-01-15T10:00:00Z',
            'taimoor-gym-history': [['2024-01-14T09:00:00Z', '2024-01-14T11:00:00Z']]
        });
    });

});