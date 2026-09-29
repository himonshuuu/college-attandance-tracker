import { Router } from "express";
import { requireAuth } from "../auth/session";
import { findUserByEnrollment } from "../users/users.repository";

export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.get("/", async (request, response) => {
  const user = await findUserByEnrollment(request.session!.enrollmentId);
  if (!user) return response.status(404).json({ error: "User not found" });
  return response.json({
    user: { email: user.email, enrollmentId: user.enrollment_id, joinedAt: user.created_at },
    profile: {
      name: user.name,
      className: user.class_name,
      stream: user.stream,
      rollNumber: user.roll_number,
      profilePhotoUrl: user.profile_photo_url,
    },
  });
});
