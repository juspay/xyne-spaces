"""Curated Lens-safe ManimCE patterns for math and probability explanations."""

from manim import *
import numpy as np


class VectorProjection(Scene):
    def construct(self):
        title = Text("Projection keeps only one direction", font_size=31).to_edge(UP)
        axes = Axes(x_range=[-1, 5, 1], y_range=[-1, 4, 1], x_length=6, y_length=3.8, tips=False)
        vector = Arrow(axes.c2p(0, 0), axes.c2p(3.4, 2.4), buff=0, color=YELLOW)
        projection = Arrow(axes.c2p(0, 0), axes.c2p(3.4, 0), buff=0, color=GREEN)
        drop = DashedLine(axes.c2p(3.4, 2.4), axes.c2p(3.4, 0), color=GREY_B)
        labels = VGroup(MathTex(r"\vec v", color=YELLOW).next_to(vector, UP), MathTex(r"\mathrm{proj}_x(\vec v)", color=GREEN).next_to(projection, DOWN))
        self.play(Write(title), Create(axes), GrowArrow(vector), Write(labels[0]))
        self.play(Create(drop), GrowArrow(projection), Write(labels[1]))


class FunctionTransform(Scene):
    def construct(self):
        title = Text("Transform the same curve, preserve the idea", font_size=30).to_edge(UP)
        axes = Axes(x_range=[-3, 3, 1], y_range=[-1, 5, 1], x_length=7, y_length=3.8)
        base = axes.plot(lambda x: x * x / 2, x_range=[-2.6, 2.6], color=BLUE)
        shifted = axes.plot(lambda x: (x - 1) ** 2 / 2 + 1, x_range=[-1.6, 3], color=YELLOW)
        label = MathTex(r"f(x)=\frac{x^2}{2}", color=BLUE).to_corner(UL)
        shifted_label = MathTex(r"f(x-1)+1", color=YELLOW).to_corner(UL)
        self.play(Write(title), Create(axes), Create(base), Write(label))
        self.play(Transform(base, shifted), TransformMatchingTex(label, shifted_label))


class MatrixTransform(Scene):
    def construct(self):
        title = Text("A matrix maps every vector by one rule", font_size=30).to_edge(UP)
        plane = NumberPlane(x_range=[-3, 3, 1], y_range=[-2, 3, 1], x_length=6, y_length=4)
        original = Arrow(plane.c2p(0, 0), plane.c2p(1, 1), buff=0, color=BLUE)
        transformed = Arrow(plane.c2p(0, 0), plane.c2p(2, 1), buff=0, color=YELLOW)
        matrix = MathTex(r"\begin{bmatrix}2&0\\0&1\end{bmatrix}", font_size=42).to_corner(UR)
        self.play(Write(title), Create(plane), GrowArrow(original), Write(matrix))
        self.play(Transform(original, transformed), Indicate(matrix, color=YELLOW))


class DerivativeTangent(Scene):
    def construct(self):
        title = Text("A derivative is local change", font_size=31).to_edge(UP)
        axes = Axes(x_range=[-1, 4, 1], y_range=[-1, 5, 1], x_length=6.5, y_length=3.8)
        curve = axes.plot(lambda x: x * x / 3, x_range=[-0.5, 3.8], color=BLUE)
        point = Dot(axes.c2p(2, 4 / 3), color=YELLOW)
        tangent = Line(axes.c2p(0.6, 0.4), axes.c2p(3.4, 3.2), color=GREEN)
        slope = MathTex(r"f'(2)=\frac{4}{3}", color=GREEN).to_corner(UR)
        self.play(Write(title), Create(axes), Create(curve), FadeIn(point))
        self.play(Create(tangent), Write(slope), Indicate(point, color=YELLOW))


class BayesUpdate(Scene):
    def construct(self):
        title = Text("Evidence updates a belief", font_size=32).to_edge(UP)
        prior = Rectangle(width=2.0, height=1.0, color=BLUE, fill_opacity=0.65).shift(LEFT * 2.4 + DOWN * 0.45)
        posterior = Rectangle(width=2.0, height=2.1, color=GREEN, fill_opacity=0.65).shift(RIGHT * 2.4 + DOWN * 0.0)
        prior_label = Text("Prior", font_size=27).next_to(prior, DOWN)
        posterior_label = Text("Posterior", font_size=27).next_to(posterior, DOWN)
        evidence = card = Text("new evidence", font_size=24, color=YELLOW).move_to(UP * 0.7)
        arrow = Arrow(prior.get_right(), posterior.get_left(), buff=0.18, color=YELLOW)
        self.play(Write(title), FadeIn(prior), Write(prior_label), FadeIn(evidence))
        self.play(GrowArrow(arrow), ReplacementTransform(prior.copy(), posterior), Write(posterior_label))
        self.play(Indicate(posterior, color=YELLOW))
