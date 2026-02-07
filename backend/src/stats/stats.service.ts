import { Injectable } from '@nestjs/common';
import { getDb } from '../db';

@Injectable()
export class StatsService {
  async summary() {
    const db = await getDb();
    const collection = db.collection('claims');

    const [totalClaims, totalAmount, statusBreakdown, topProcedures] = await Promise.all([
      collection.countDocuments(),
      collection.aggregate([
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ]).toArray(),
      collection.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
      collection.aggregate([
        { $unwind: '$procedureCodes' },
        { $group: { _id: '$procedureCodes', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]).toArray(),
    ]);

    return {
      data: {
        totalClaims,
        totalAmount: totalAmount[0]?.total || 0,
        statusBreakdown,
        topProcedures,
      },
    };
  }
}
