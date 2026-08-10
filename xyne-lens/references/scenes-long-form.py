"""Executable chapter-method pattern for an Xyne Lens long-form lesson."""

from manim import *


class FullLesson(Scene):
    def construct(self):
        self.chapter_hook()
        self.chapter_model()
        self.chapter_mechanism()
        self.chapter_takeaway()

    def chapter_hook(self):
        title = Text("Why does the cache help?", font_size=42)
        self.play(Write(title))
        self.wait(0.4)
        self.play(FadeOut(title))

    def chapter_model(self):
        self.cache = RoundedRectangle(width=2.5, height=1.1, color=YELLOW)
        self.cache_label = Text("Cache", font_size=30).move_to(self.cache)
        self.play(Create(self.cache), Write(self.cache_label))
        self.wait(0.3)

    def chapter_mechanism(self):
        request = Dot(LEFT * 4, color=BLUE)
        self.play(FadeIn(request), request.animate.move_to(self.cache.get_left() + LEFT * 0.25), run_time=0.7)
        self.play(Indicate(self.cache, color=GREEN))
        self.wait(0.3)

    def chapter_takeaway(self):
        self.play(FadeOut(VGroup(self.cache, self.cache_label)))
        takeaway = Text("Reuse avoids repeated work", font_size=38, color=GREEN)
        self.play(Write(takeaway))
        self.wait(0.5)


class MechanismPreview(FullLesson):
    def construct(self):
        self.chapter_model()
        self.chapter_mechanism()
