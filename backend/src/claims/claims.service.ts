import { Injectable } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { getDb } from '../db';
import { ClaimsQuery } from './claims.dto';

const ALLOWED_SORT_FIELDS = new Set(['serviceDate', 'totalAmount', 'status', 'memberRegion', 'providerSpecialty']);
const CURSOR_SEPARATOR = '|';

function parseCursor(cursor: string) {
  const [dateStr, idStr] = cursor.split(CURSOR_SEPARATOR);
  if (!dateStr || !idStr || !ObjectId.isValid(idStr)) {
    return null;
  }
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return { date, id: new ObjectId(idStr) };
}

@Injectable()
export class ClaimsService {
  async listClaims(query: ClaimsQuery) {
    const db = await getDb();
    const collection = db.collection('claims');

    const baseFilter: Record<string, unknown> = {};
    const andFilters: Record<string, unknown>[] = [];

    if (query.status) {
      baseFilter.status = query.status;
    }
    if (query.region) {
      baseFilter.memberRegion = query.region;
    }
    if (query.providerSpecialty) {
      baseFilter.providerSpecialty = query.providerSpecialty;
    }
    if (query.startDate || query.endDate) {
      baseFilter.serviceDate = {
        ...(query.startDate ? { $gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { $lte: new Date(query.endDate) } : {}),
      };
    }
    if (typeof query.minAmount === 'number' || typeof query.maxAmount === 'number') {
      baseFilter.totalAmount = {
        ...(typeof query.minAmount === 'number' ? { $gte: query.minAmount } : {}),
        ...(typeof query.maxAmount === 'number' ? { $lte: query.maxAmount } : {}),
      };
    }
    if (query.codes) {
      const codes = query.codes.split(',').map((code) => code.trim()).filter(Boolean);
      if (codes.length > 0) {
        andFilters.push({
          $or: [
            { procedureCodes: { $in: codes } },
            { diagnosisCodes: { $in: codes } },
          ],
        });
      }
    }
    if (query.q) {
      andFilters.push({ $text: { $search: query.q } });
    }

    if (Object.keys(baseFilter).length > 0) {
      andFilters.push(baseFilter);
    }

    const hasCursor = query.cursor !== undefined;
    const sortBy = hasCursor ? 'serviceDate' : (ALLOWED_SORT_FIELDS.has(query.sortBy) ? query.sortBy : 'serviceDate');
    const sortDir = query.sortDir === 'asc' ? 1 : -1;
    const page = query.page || 1;
    const pageSize = query.pageSize || 50;
    const includeTotal = query.includeTotal === '1' || query.includeTotal === 'true';

    let cursorFilter: Record<string, unknown> | null = null;
    if (query.cursor) {
      const parsed = parseCursor(query.cursor);
      if (parsed) {
        cursorFilter = sortDir === -1
          ? {
              $or: [
                { serviceDate: { $lt: parsed.date } },
                { serviceDate: parsed.date, _id: { $lt: parsed.id } },
              ],
            }
          : {
              $or: [
                { serviceDate: { $gt: parsed.date } },
                { serviceDate: parsed.date, _id: { $gt: parsed.id } },
              ],
            };
      }
    }
    if (cursorFilter) {
      andFilters.push(cursorFilter);
    }

    const filter = andFilters.length === 0
      ? {}
      : (andFilters.length === 1 ? andFilters[0] : { $and: andFilters });

    const start = Date.now();
    let items = [] as Record<string, unknown>[];
    let total: number | null = null;
    let nextCursor: string | null = null;
    let hasMore: boolean | null = null;

    if (hasCursor) {
      const results = await collection
        .find(filter)
        .sort({ serviceDate: sortDir, _id: sortDir })
        .limit(pageSize + 1)
        .toArray();

      hasMore = results.length > pageSize;
      items = hasMore ? results.slice(0, pageSize) : results;
      const last = items[items.length - 1] as { _id?: ObjectId; serviceDate?: Date } | undefined;
      if (hasMore && last?._id && last?.serviceDate instanceof Date) {
        nextCursor = `${last.serviceDate.toISOString()}${CURSOR_SEPARATOR}${last._id.toString()}`;
      }
    } else {
      const cursor = collection
        .find(filter)
        .sort({ [sortBy]: sortDir })
        .skip((page - 1) * pageSize)
        .limit(pageSize);

      if (includeTotal) {
        const [pageItems, count] = await Promise.all([
          cursor.toArray(),
          collection.countDocuments(filter),
        ]);
        items = pageItems;
        total = count;
      } else {
        items = await cursor.toArray();
      }
    }

    return {
      data: items,
      meta: {
        page,
        pageSize,
        total,
        sortBy,
        sortDir: sortDir === 1 ? 'asc' : 'desc',
        hasMore,
        nextCursor,
        queryTimeMs: Date.now() - start,
      },
    };
  }

  async getClaim(id: string) {
    const db = await getDb();
    const collection = db.collection('claims');

    if (!ObjectId.isValid(id)) {
      return { data: null };
    }

    const claim = await collection.findOne({ _id: new ObjectId(id) });
    return { data: claim };
  }
}
