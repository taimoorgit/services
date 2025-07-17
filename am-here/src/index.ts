import { z } from 'zod';

interface Env {
    CACHE: KVNamespace;
}

const RequestSchema = z.object({
    method: z.literal('POST'),
    body: z.object({
        location: z.string().min(1).regex(/^[a-zA-Z0-9_]+$/),
        datetime: z.string().datetime(),
        arrived: z.boolean(),
        person: z.string().min(1).regex(/^[a-zA-Z0-9_]+$/)
    })
});


const jsonResponse = (message: string, status = 200): Response => {
    return new Response(JSON.stringify({ message }), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
};

const fetch = async (request: Request, env: Env): Promise<Response> => {
    if (request.method === 'GET') {
        const keys = await env.CACHE.list();
        const cacheData: Record<string, any> = {};

        for (const key of keys.keys) {
            const value = await env.CACHE.get(key.name);
            if (value) {
                try {
                    cacheData[key.name] = JSON.parse(value);
                } catch {
                    cacheData[key.name] = value;
                }
            }
        }

        return new Response(JSON.stringify(cacheData, null, 2), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const jsonData = await request.json();

        const result = RequestSchema.safeParse({
            method: request.method,
            body: jsonData
        });
        if (!result.success) return jsonResponse('Invalid request', 400);

        const { body } = result.data;

        if (body.arrived) {
            const arriveKey = `${body.person}-${body.location}-arrive`;
            await env.CACHE.put(arriveKey, body.datetime);
            return jsonResponse(`${body.person} arrived ${body.location} at ${body.datetime}`);
        } else {
            const arrivedAtKey = `${body.person}-${body.location}-arrive`;
            const arrivedAt = await env.CACHE.get(arrivedAtKey);
            const leftAt = body.datetime;

            if (arrivedAt) {
                const historyKey = `${body.person}-${body.location}-history`;
                const existingHistory = await env.CACHE.get(historyKey);
                const history = existingHistory ? JSON.parse(existingHistory) : [];
                history.push([arrivedAt, leftAt]);
                await env.CACHE.put(historyKey, JSON.stringify(history));
                await env.CACHE.delete(arrivedAtKey);
                return jsonResponse(`${body.person} left ${body.location} at ${body.datetime} (arrived at ${arrivedAt})`);
            } else {
                return jsonResponse(`${body.person} left ${body.location} at ${body.datetime} (has no arrival)`);
            }
        }
    } catch (error) {
        return jsonResponse('Invalid JSON', 400);
    }
};

export default { fetch };