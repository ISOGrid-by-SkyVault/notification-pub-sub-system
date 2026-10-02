/**
 * Gateway layer: the only place that runs Mongoose queries. Managers, the
 * worker and the SSE route go through it, which keeps persistence details out
 * of the business flow and gives the tests a single object to mock.
 */
import { UserModel, IUser } from "../models/User";
import { BatchModel, IBatch } from "../models/Batch";
import { NotificationModel, INotification } from "../models/Notification";

export class DbGateway {
  // User Operations
  
  /**
   * Retrieves all users.
   */
  public async getUsers(): Promise<IUser[]> {
    return UserModel.find({}).exec();
  }

  /**
   * Retrieves a single user matching an email.
   */
  public async getUserByEmail(email: string): Promise<IUser | null> {
    return UserModel.findOne({ email }).exec();
  }

  /**
   * Retrieves users matching a set of emails.
   */
  public async getUsersByEmails(emails: string[]): Promise<IUser[]> {
    return UserModel.find({ email: { $in: emails } }).exec();
  }

  // Batch Operations

  /**
   * Persists a new enrollment batch.
   */
  public async createBatch(batchData: Partial<IBatch>): Promise<IBatch> {
    const batch = new BatchModel(batchData);
    return batch.save();
  }

  /**
   * Retrieves an enrollment batch by ID.
   */
  public async getBatchById(batchId: string): Promise<IBatch | null> {
    return BatchModel.findOne({ batchId }).exec();
  }

  /**
   * Lists batches using cursor pagination (page/limit).
   */
  public async getBatchesPaginated(page: number, limit: number): Promise<{ batches: IBatch[]; total: number }> {
    const skip = (page - 1) * limit;
    const [batches, total] = await Promise.all([
      BatchModel.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      BatchModel.countDocuments({}).exec()
    ]);
    return { batches, total };
  }

  // Notification Operations

  /**
   * Bulk inserts notification dispatch documents.
   */
  public async createNotifications(notificationsData: Partial<INotification>[]): Promise<INotification[]> {
    return NotificationModel.insertMany(notificationsData) as any;
  }

  /**
   * Retrieves all notifications linked to a batch.
   */
  public async getNotificationsByBatchId(batchId: string): Promise<INotification[]> {
    return NotificationModel.find({ batchId }).exec();
  }

  /**
   * Updates status metadata for an individual notification.
   */
  public async updateNotificationStatus(
    notificationId: string,
    update: { status: "pending" | "delivered" | "dead"; attempts: number; error?: string; dispatchedAt?: Date }
  ): Promise<INotification | null> {
    return NotificationModel.findOneAndUpdate(
      { notificationId },
      { $set: update },
      { new: true }
    ).exec();
  }

  /**
   * Counts the total number of notifications for a batch.
   */
  public async countBatchNotifications(batchId: string): Promise<number> {
    return NotificationModel.countDocuments({ batchId }).exec();
  }

  /**
   * Counts the number of notifications in a terminal state (delivered/dead).
   */
  public async countFinishedNotifications(batchId: string): Promise<number> {
    return NotificationModel.countDocuments({
      batchId,
      status: { $in: ["delivered", "dead"] }
    }).exec();
  }

  /**
   * Atomically transitions a batch state to "completed" if it isn't already.
   */
  public async transitionBatchToCompleted(batchId: string): Promise<IBatch | null> {
    return BatchModel.findOneAndUpdate(
      { batchId, status: { $ne: "completed" } },
      { $set: { status: "completed", completedAt: new Date() } },
      { new: true }
    ).exec();
  }

  /**
   * Retrieves all pending notifications for a specific user ID.
   */
  public async getPendingNotificationsForUser(userId: string): Promise<INotification[]> {
    return NotificationModel.find({
      userId,
      status: "pending",
      dispatchedAt: { $exists: true, $ne: null }
    }).exec();
  }
}

export const dbGateway = new DbGateway();
