"""Curated Lens-safe ManimCE patterns for databases and data structures."""

from manim import *


def card(label, color=BLUE, width=1.65, height=0.68):
    box = RoundedRectangle(width=width, height=height, corner_radius=0.1, color=color)
    text = Text(label, font_size=22, color=WHITE).move_to(box)
    return VGroup(box, text)


class CacheAside(Scene):
    def construct(self):
        title = Text("Cache-aside: check fast storage first", font_size=29).to_edge(UP)
        app, cache, db = card("App", BLUE), card("Cache", YELLOW), card("Database", ORANGE)
        VGroup(app, cache, db).arrange(RIGHT, buff=1.0).move_to(ORIGIN)
        to_cache = Arrow(app.get_right(), cache.get_left(), buff=0.08)
        to_db = Arrow(cache.get_right(), db.get_left(), buff=0.08)
        miss = Text("miss", font_size=22, color=RED).next_to(to_db, UP)
        hit = Text("populate → hit", font_size=22, color=GREEN).next_to(to_cache, DOWN)
        self.play(Write(title), FadeIn(app), FadeIn(cache), FadeIn(db), GrowArrow(to_cache))
        self.play(GrowArrow(to_db), FadeIn(miss), Indicate(db, color=YELLOW))
        self.play(FadeOut(miss), FadeIn(hit), Indicate(cache, color=GREEN))


class DatabaseIndex(Scene):
    def construct(self):
        title = Text("An index narrows the search", font_size=31).to_edge(UP)
        index = VGroup(*[card(key, TEAL, width=0.95) for key in ["A", "M", "T"]]).arrange(RIGHT, buff=0.22)
        index.shift(UP * 0.8)
        rows = VGroup(*[card(f"row {i}", GREY_B, width=1.15) for i in range(1, 6)]).arrange(RIGHT, buff=0.15).shift(DOWN * 1.1)
        pointer = Arrow(index[1].get_bottom(), rows[2].get_top(), buff=0.1, color=YELLOW)
        self.play(Write(title), FadeIn(index), FadeIn(rows))
        self.play(Indicate(index[1], color=YELLOW), GrowArrow(pointer), Indicate(rows[2], color=YELLOW))


class BTreeLookup(Scene):
    def construct(self):
        title = Text("A B-tree routes a key through decisions", font_size=29).to_edge(UP)
        root = card("50", YELLOW).shift(UP * 1.45)
        left, right = card("20", TEAL), card("80", TEAL)
        VGroup(left, right).arrange(RIGHT, buff=3.1).shift(DOWN * 0.1)
        leaf = card("35", GREEN).next_to(left, DOWN, buff=0.85)
        edges = VGroup(Arrow(root.get_bottom(), left.get_top(), buff=0.08), Arrow(root.get_bottom(), right.get_top(), buff=0.08), Arrow(left.get_bottom(), leaf.get_top(), buff=0.08))
        key = Text("find 35", font_size=25, color=WHITE).next_to(root, RIGHT)
        self.play(Write(title), FadeIn(root), FadeIn(left), FadeIn(right), FadeIn(leaf), Create(edges), FadeIn(key))
        self.play(Indicate(root, color=YELLOW), Indicate(left, color=YELLOW), Indicate(leaf, color=GREEN))


class TransactionLifecycle(Scene):
    def construct(self):
        title = Text("A transaction makes its outcome explicit", font_size=30).to_edge(UP)
        states = VGroup(*[card(label, color, width=1.45) for label, color in [("BEGIN", BLUE), ("WRITE", TEAL), ("COMMIT", GREEN)]]).arrange(RIGHT, buff=0.65)
        arrows = VGroup(*[Arrow(states[i].get_right(), states[i + 1].get_left(), buff=0.08) for i in range(2)])
        rollback = card("ROLLBACK", RED, width=1.7).next_to(states[1], DOWN, buff=0.9)
        rollback_arrow = Arrow(states[1].get_bottom(), rollback.get_top(), buff=0.08, color=RED)
        self.play(Write(title), FadeIn(states), Create(arrows))
        self.play(Indicate(states[1], color=YELLOW), GrowArrow(rollback_arrow), FadeIn(rollback))
        self.play(FadeOut(rollback_arrow), FadeOut(rollback), Indicate(states[2], color=GREEN))


class QueryPipeline(Scene):
    def construct(self):
        title = Text("A query becomes smaller at each stage", font_size=30).to_edge(UP)
        stages = VGroup(*[card(label, color, width=1.55) for label, color in [("Scan", GREY_B), ("Filter", BLUE), ("Join", TEAL), ("Result", GREEN)]]).arrange(RIGHT, buff=0.42)
        arrows = VGroup(*[Arrow(stages[i].get_right(), stages[i + 1].get_left(), buff=0.06) for i in range(3)])
        counts = VGroup(*[Text(count, font_size=20, color=YELLOW).next_to(stage, DOWN) for stage, count in zip(stages, ["1M", "20k", "400", "12"])])
        self.play(Write(title), FadeIn(stages), Create(arrows))
        self.play(LaggedStart(*[FadeIn(count, shift=UP * 0.1) for count in counts], lag_ratio=0.18))
