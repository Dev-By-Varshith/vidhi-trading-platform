from setuptools import setup, find_packages

setup(
    name="vidhi-sdk",
    version="1.0.0",
    description="Project Vidhi Algorithmic Trading Contest SDK",
    author="Vidhi Platform",
    packages=find_packages(where=".", include=["*"]),
    package_dir={"": "."},
    install_requires=[
        "numba>=0.58.0",
        "requests>=2.30.0",
    ],
    entry_points={
        "console_scripts": [
            "vidhi=vidhi_sdk.cli:main",
        ],
    },
    python_requires=">=3.10",
)
