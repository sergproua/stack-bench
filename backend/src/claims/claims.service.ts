import { Injectable } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { getDb } from '../db';
import { ClaimsQuery } from './claims.dto';

const ALLOWED_SORT_FIELDS = new Set(['serviceDate', 'totalAmount', 'status', 'memberRegion', 'providerSpecialty']);

@Injectable()
export class ClaimsService {
  async listClaims(query: ClaimsQuery) {
    const db = await getDb();
    const collection = db.collection('claims');

    const filter: Record<string, unknown> = {};

    if (query.status) {
      filter.status = query.status;
    }
    if (query.region) {
      filter.memberRegion = query.region;
    }
    if (query.providerSpecialty) {
      filter.providerSpecialty = query.providerSpecialty;
    }
    if (query.startDate || query.endDate) {
      filter.serviceDate = {
        ...(query.startDate ? { $gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { $lte: new Date(query.endDate) } : {}),
      };
    }
    if (typeof query.minAmount === 'number' || typeof query.maxAmount === 'number') {
      filter.totalAmount = {
        ...(typeof query.minAmount === 'number' ? { $gte: query.minAmount } : {}),
        ...(typeof query.maxAmount === 'number' ? { $lte: query.maxAmount } : {}),
      };
    }
    if (query.codes) {
      const codes = query.codes.split(',').map((code) => code.trim()).filter(Boolean);
      if (codes.length > 0) {
        filter.$or = [
          { procedureCodes: { $in: codes } },
          { diagnosisCodes: { $in: codes } },
        ];
      }
    }
    if (query.q) {
      filter.$text = { $search: query.q };
    }

    const sortBy = ALLOWED_SORT_FIELDS.has(query.sortBy) ? query.sortBy : 'serviceDate';
    const sortDir = query.sortDir === 'asc' ? 1 : -1;
    const page = query.page || 1;
    const pageSize = query.pageSize || 50;

    const start = Date.now();
    const cursor = collection
      .find(filter)
      .sort({ [sortBy]: sortDir })
      .skip((page - 1) * pageSize)
      .limit(pageSize);

    const [items, total] = await Promise.all([
      cursor.toArray(),
      collection.countDocuments(filter),
    ]);

    return {
      data: items,
      meta: {
        page,
        pageSize,
        total,
        sortBy,
        sortDir: query.sortDir,
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
