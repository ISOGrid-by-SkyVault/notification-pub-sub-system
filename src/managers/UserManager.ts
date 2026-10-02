/**
 * Manager layer for users.
 */
import { dbGateway } from "../gateways/DbGateway";
import { IUser } from "../models/User";

export class UserManager {
  /**
   * Retrieves all users via the database gateway.
   */
  public async getAllUsers(): Promise<IUser[]> {
    return dbGateway.getUsers();
  }
}

export const userManager = new UserManager();
