"""Offline smoke scene for the complete Xyne Lens Manim Community image.

It deliberately exercises the dependency boundary that a text-only Manim
image misses: MathTex with the mathrsfs package, NumPy, a ThreeDScene, and the
Cairo renderer. It is not exposed to Lens agents or copied into their sandbox.
"""

from manim import *
import numpy as np


class LensManimCommunitySmoke(ThreeDScene):
    def construct(self):
        self.set_camera_orientation(phi=60 * DEGREES, theta=-45 * DEGREES)
        axes = ThreeDAxes(x_range=[-2, 2, 1], y_range=[-2, 2, 1], z_range=[-1, 2, 1])
        surface = Surface(
            lambda u, v: np.array([u, v, 0.35 * (u * u + v * v)]),
            u_range=[-1, 1],
            v_range=[-1, 1],
            resolution=(8, 8),
        ).set_style(fill_opacity=0.55, stroke_width=0.5)
        template = TexTemplate()
        template.add_to_preamble(r"\usepackage{mathrsfs}")
        equation = MathTex(
            r"\mathscr{F} = \int_0^\infty e^{-x^2}\,dx",
            tex_template=template,
        )
        equation.to_corner(UL)
        self.add(axes, surface, equation)
