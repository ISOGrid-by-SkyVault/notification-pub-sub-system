/**
 * View layer for users: maps Mongoose documents to the JSON returned by the API.
 */
import { IUser } from "../models/User";

export interface UserResponse {
  userId: string;
  name: string;
  email: string;
}

export class UserView {
  /**
   * Renders a single user model into a standardized JSON response.
   */
  public renderSingle(user: IUser): UserResponse {
    return {
      userId: user.userId,
      name: user.name,
      email: user.email,
    };
  }

  /**
   * Renders a list of user models into a list of standardized JSON responses.
   */
  public renderList(users: IUser[]): UserResponse[] {
    return users.map((u) => this.renderSingle(u));
  }
}

export const userView = new UserView();
