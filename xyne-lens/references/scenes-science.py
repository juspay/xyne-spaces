"""Curated Lens-safe ManimCE patterns for physics and general science explanations."""

from manim import *
import numpy as np


class WaveInterference(Scene):
    def construct(self):
        title = Text("Waves add point by point", font_size=31).to_edge(UP)
        axes = Axes(x_range=[0, TAU, PI], y_range=[-2, 2, 1], x_length=7, y_length=3.6, tips=False)
        wave_a = axes.plot(lambda x: np.sin(x), x_range=[0, TAU], color=BLUE)
        wave_b = axes.plot(lambda x: 0.5 * np.sin(x), x_range=[0, TAU], color=GREEN)
        combined = axes.plot(lambda x: 1.5 * np.sin(x), x_range=[0, TAU], color=YELLOW)
        caption = Text("result", font_size=24, color=YELLOW).next_to(axes, DOWN)
        self.play(Write(title), Create(axes), Create(wave_a), Create(wave_b))
        self.play(Transform(wave_a, combined), FadeOut(wave_b), FadeIn(caption))


class PendulumEnergy(Scene):
    def construct(self):
        title = Text("Energy trades between height and speed", font_size=30).to_edge(UP)
        pivot = Dot(UP * 2.2, color=WHITE)
        rod = Line(pivot.get_center(), pivot.get_center() + DOWN * 2.6 + RIGHT * 1.2, color=GREY_B)
        bob = Dot(rod.get_end(), radius=0.18, color=YELLOW)
        pendulum = VGroup(rod, bob)
        potential = Text("potential", font_size=23, color=BLUE).to_corner(DL)
        kinetic = Text("kinetic", font_size=23, color=GREEN).to_corner(DR)
        self.play(Write(title), FadeIn(pivot), Create(rod), FadeIn(bob), Write(potential))
        self.play(Rotate(pendulum, angle=-50 * DEGREES, about_point=pivot.get_center()), Transform(potential, kinetic), run_time=1.2, rate_func=smooth)


class OrbitMechanics(Scene):
    def construct(self):
        title = Text("Gravity bends motion into an orbit", font_size=31).to_edge(UP)
        sun = Dot(ORIGIN, radius=0.25, color=YELLOW)
        orbit = Ellipse(width=6.2, height=3.3, color=BLUE)
        planet = Dot(orbit.get_left(), radius=0.13, color=GREEN)
        velocity = Arrow(planet.get_center(), planet.get_center() + UP * 0.8, buff=0, color=GREEN)
        force = Arrow(planet.get_center(), sun.get_center(), buff=0.12, color=RED)
        self.play(Write(title), FadeIn(sun), Create(orbit), FadeIn(planet), GrowArrow(velocity), GrowArrow(force))
        self.play(MoveAlongPath(planet, orbit), run_time=1.5, rate_func=linear)


class GeometryPythagoras(Scene):
    def construct(self):
        title = Text("Area makes the Pythagorean relation visible", font_size=29).to_edge(UP)
        triangle = Polygon(LEFT * 2 + DOWN, LEFT * 2 + UP * 1.5, RIGHT * 1 + DOWN, color=WHITE, fill_opacity=0.18)
        a = Square(side_length=2.5, color=BLUE, fill_opacity=0.3).next_to(triangle, LEFT, buff=0)
        b = Square(side_length=3, color=GREEN, fill_opacity=0.3).next_to(triangle, DOWN, buff=0)
        equation = MathTex(r"a^2+b^2=c^2", color=YELLOW).to_corner(UR)
        self.play(Write(title), Create(triangle), FadeIn(a), FadeIn(b))
        self.play(Write(equation), Indicate(triangle, color=YELLOW))


class SignalSampling(Scene):
    def construct(self):
        title = Text("Sampling measures a continuous signal at intervals", font_size=29).to_edge(UP)
        axes = Axes(x_range=[0, 6, 1], y_range=[-1.5, 1.5, 1], x_length=7, y_length=3.4, tips=False)
        signal = axes.plot(lambda x: np.sin(2 * x), x_range=[0, 6], color=BLUE)
        sample_x = np.linspace(0.2, 5.8, 11)
        samples = VGroup(*[Dot(axes.c2p(x, np.sin(2 * x)), radius=0.07, color=YELLOW) for x in sample_x])
        caption = Text("discrete samples", font_size=24, color=YELLOW).next_to(axes, DOWN)
        self.play(Write(title), Create(axes), Create(signal))
        self.play(LaggedStart(*[FadeIn(dot) for dot in samples], lag_ratio=0.08), FadeIn(caption))


class SurfaceLandscape(ThreeDScene):
    def construct(self):
        self.set_camera_orientation(phi=65 * DEGREES, theta=-45 * DEGREES)
        axes = ThreeDAxes(x_range=[-2, 2, 1], y_range=[-2, 2, 1], z_range=[-1, 2, 1])
        surface = Surface(
            lambda u, v: np.array([u, v, 0.35 * (u * u - v * v)]),
            u_range=[-1.6, 1.6], v_range=[-1.6, 1.6], resolution=(12, 12),
        ).set_style(fill_opacity=0.58, stroke_width=0.5)
        title = Text("A surface maps two inputs to one height", font_size=30).to_corner(UL)
        self.add_fixed_in_frame_mobjects(title)
        self.play(Create(axes), FadeIn(surface), Write(title))
        self.begin_ambient_camera_rotation(rate=0.12)
        self.wait(0.8)
        self.stop_ambient_camera_rotation()
