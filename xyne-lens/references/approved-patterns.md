# Approved patterns

## Equation transformation

```python
equation = MathTex(r"a^2 + b^2 = c^2")
result = MathTex(r"c = \sqrt{a^2 + b^2}")
self.play(Write(equation))
self.play(TransformMatchingTex(equation, result))
```

## Moving graph point

```python
axes = Axes(x_range=[0, 4, 1], y_range=[0, 5, 1], x_length=7, y_length=3.5)
curve = axes.plot(lambda x: x ** 2 / 3, x_range=[0, 3.7], color=BLUE)
tracker = ValueTracker(0)
dot = always_redraw(lambda: Dot(axes.c2p(tracker.get_value(), tracker.get_value() ** 2 / 3), color=YELLOW))
self.play(Create(axes), Create(curve))
self.add(dot)
self.play(tracker.animate.set_value(3.5), run_time=2, rate_func=smooth)
```

## Coupled objects

```python
left = Dot(LEFT * 3, color=RED)
right = Dot(RIGHT * 3, color=BLUE)
distance = always_redraw(lambda: DashedLine(left.get_center(), right.get_center(), color=ORANGE))
self.add(left, right, distance)
self.play(left.animate.shift(RIGHT), right.animate.shift(LEFT), run_time=1.2)
```

## Small Cairo 3D surface

```python
class SurfaceBeat(ThreeDScene):
    def construct(self):
        self.set_camera_orientation(phi=65 * DEGREES, theta=-45 * DEGREES)
        axes = ThreeDAxes()
        surface = Surface(
            lambda u, v: np.array([u, v, u * u - v * v]),
            u_range=[-1, 1], v_range=[-1, 1], resolution=(12, 12),
        )
        self.play(Create(axes), FadeIn(surface))
```
