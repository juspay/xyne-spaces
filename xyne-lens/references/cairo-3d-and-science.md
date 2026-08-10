# Cairo 3D and scientific computation

Use 3D only when depth communicates a relationship that a 2D projection cannot. `ThreeDScene`, `ThreeDAxes`, `Surface`, `Sphere`, `ParametricFunction`, `set_camera_orientation`, `begin_ambient_camera_rotation`, and fixed-in-frame overlays are available in the Cairo renderer.

- Keep surface resolution modest and camera movement short.
- Use `add_fixed_in_frame_mobjects` for titles or equations that must remain readable during a camera move.
- Prefer a 2D projection when the camera is not teaching anything.
- Never request an OpenGL renderer or use interactive camera APIs.

Use NumPy for vectorized coordinates, sampled curves, matrices, and numerical values. Use SciPy only for bounded precomputed calculations, such as `solve_ivp` for a short trajectory. Compute numerical data once in `construct`; do not run expensive work inside updaters.
