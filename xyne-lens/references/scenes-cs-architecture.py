"""Curated Lens-safe ManimCE patterns for architecture and code explanations."""

from manim import *


def card(label, color=BLUE, width=1.7, height=0.72):
    box = RoundedRectangle(width=width, height=height, corner_radius=0.12, color=color)
    text = Text(label, font_size=24, color=WHITE)
    text.move_to(box)
    return VGroup(box, text)


class LayeredArchitecture(Scene):
    def construct(self):
        title = Text("One request, clear responsibilities", font_size=32).to_edge(UP)
        labels = [("Client", BLUE), ("API", TEAL), ("Service", GREEN), ("Database", ORANGE)]
        layers = VGroup(*[card(label, color, width=5.4) for label, color in labels]).arrange(DOWN, buff=0.28)
        self.play(Write(title), LaggedStart(*[FadeIn(layer, shift=RIGHT * 0.25) for layer in layers], lag_ratio=0.16))
        focus = SurroundingRectangle(layers[2], color=YELLOW, buff=0.1)
        self.play(Create(focus), Indicate(layers[2], color=YELLOW))
        self.wait(0.4)


class RequestLifecycle(Scene):
    def construct(self):
        title = Text("A request crosses stable boundaries", font_size=30).to_edge(UP)
        nodes = VGroup(card("Client", BLUE), card("API", TEAL), card("Service", GREEN), card("DB", ORANGE)).arrange(RIGHT, buff=0.5).scale(0.82)
        nodes.move_to(DOWN * 0.25)
        arrows = VGroup(*[Arrow(nodes[i].get_right(), nodes[i + 1].get_left(), buff=0.08, color=GREY_B) for i in range(3)])
        payload = card("GET /orders", YELLOW, width=1.45, height=0.52).scale(0.68).next_to(nodes[0], UP)
        self.play(Write(title), FadeIn(nodes), Create(arrows), FadeIn(payload))
        for target in nodes[1:]:
            self.play(payload.animate.next_to(target, UP), run_time=0.45)
        self.play(Indicate(nodes[-1], color=YELLOW))


class LoadBalancing(Scene):
    def construct(self):
        title = Text("One entry point distributes work", font_size=30).to_edge(UP)
        gateway = card("Load balancer", TEAL, width=2.25).shift(LEFT * 2.5)
        instances = VGroup(*[card(f"Instance {i}", GREEN, width=1.8) for i in range(1, 4)]).arrange(DOWN, buff=0.35).shift(RIGHT * 2.5)
        clients = VGroup(*[Dot(LEFT * 5 + UP * y, color=BLUE) for y in (-1.1, 0, 1.1)])
        inbound = VGroup(*[Arrow(dot.get_right(), gateway.get_left(), buff=0.08, color=BLUE) for dot in clients])
        outbound = VGroup(*[Arrow(gateway.get_right(), instance.get_left(), buff=0.08, color=GREEN) for instance in instances])
        self.play(Write(title), FadeIn(clients), FadeIn(gateway), FadeIn(instances))
        self.play(LaggedStart(*[GrowArrow(arrow) for arrow in inbound], lag_ratio=0.15), LaggedStart(*[GrowArrow(arrow) for arrow in outbound], lag_ratio=0.15))
        self.play(Indicate(gateway, color=YELLOW))


class DependencyGraph(Scene):
    def construct(self):
        title = Text("Change the dependency, see the impact", font_size=30).to_edge(UP)
        api = card("API", BLUE).shift(LEFT * 3)
        service = card("Service", GREEN)
        db = card("Database", ORANGE).shift(RIGHT * 3)
        queue = card("Events", PURPLE).shift(DOWN * 1.7)
        links = VGroup(
            Arrow(api.get_right(), service.get_left(), buff=0.08),
            Arrow(service.get_right(), db.get_left(), buff=0.08),
            Arrow(service.get_bottom(), queue.get_top(), buff=0.08),
        )
        self.play(Write(title), FadeIn(api), FadeIn(service), FadeIn(db), FadeIn(queue), Create(links))
        impact = VGroup(SurroundingRectangle(service, color=YELLOW, buff=0.1), SurroundingRectangle(queue, color=YELLOW, buff=0.1))
        self.play(Create(impact), Indicate(service, color=YELLOW), Indicate(queue, color=YELLOW))


class CodeReviewFlow(Scene):
    def construct(self):
        title = Text("Review turns a change into a shared decision", font_size=29).to_edge(UP)
        before = card("- retry forever", RED, width=2.45).shift(LEFT * 2.2)
        after = card("+ bounded retries", GREEN, width=2.45).shift(RIGHT * 2.2)
        comment = Text("What happens during an outage?", font_size=24, color=YELLOW).next_to(before, DOWN)
        approval = card("Approved", GREEN, width=1.65).next_to(after, DOWN)
        self.play(Write(title), FadeIn(before), Write(comment))
        self.play(ReplacementTransform(before.copy(), after), FadeOut(comment))
        self.play(FadeIn(approval, shift=UP * 0.2), Indicate(after, color=YELLOW))
