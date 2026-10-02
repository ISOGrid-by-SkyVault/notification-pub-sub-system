/**
 * Controller layer for users: HTTP in, UserManager call, UserView out.
 */
import { Request, Response } from "express";
import { userManager } from "../managers/UserManager";
import { userView } from "../views/UserView";

export class UserController {
  /**
   * GET /api/users
   * Lists all users in the system.
   */
  public async listUsers(req: Request, res: Response): Promise<void> {
    try {
      const users = await userManager.getAllUsers();
      res.status(200).json(userView.renderList(users));
    } catch (error) {
      console.error("[UserController] Error listing users:", error);
      res.status(500).json({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const userController = new UserController();
